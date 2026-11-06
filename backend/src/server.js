'use strict';

const http = require('http');
const app = require('./app');
const config = require('./config');
const { logger } = require('./logger');
const { verifyTransport } = require('./services/email');
const { checkTokenVersion, currentTokenVersions } = require('./middleware/auth');
const { attachWebSocketServer } = require('./realtime/wsServer');
const redis = require('./redis/client');
const { query, pool } = require('./db');
const { createShutdown } = require('./shutdown');
const { purgeOldIps } = require('./services/visits');

const server = http.createServer(app);
let realtime = null; // serveur temps réel, arrêté avec le reste (#237)

// Démarrage asynchrone : Redis est OBLIGATOIRE (#31) — l'état temps-réel PvP y
// vit. On échoue vite et clairement s'il est injoignable plutôt que d'accepter
// des connexions dans un état dégradé.
(async () => {
  try {
    await redis.getClient().ping();
    logger.info('Redis connecté');
  } catch (err) {
    logger.fatal({ err }, 'Redis injoignable — arrêt (REDIS_URL)');
    process.exit(1);
  }

  // Transport temps-réel PvP (WebSocket sur /ws), greffé sur le même serveur HTTP.
  // validateUser : refuse les tokens révoqués (version de token, #117).
  // currentTokenVersions : ferme les sockets ouverts avant une révocation (#232).
  realtime = await attachWebSocketServer(server, { validateUser: checkTokenVersion, currentTokenVersions });

  server.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'Serveur démarré');
    // Vérifie la connexion SMTP au démarrage pour rendre un problème de conf mail
    // immédiatement visible dans les logs (non bloquant pour le serveur HTTP).
    verifyTransport();
  });

  // Durée de conservation des IP des visites (#311) : purge au démarrage puis
  // toutes les heures. Requête idempotente, sans risque si plusieurs instances.
  const purgeIps = () => purgeOldIps(query)
    .then(n => { if (n) logger.info({ n }, 'visites : IP anciennes effacées'); })
    .catch(err => logger.error({ err }, 'visites : purge des IP échouée'));
  purgeIps();
  setInterval(purgeIps, 60 * 60 * 1000).unref();
})();

server.on('error', (err) => {
  logger.fatal({ err }, 'Erreur serveur HTTP');
  process.exit(1);
});

const shutdown = createShutdown({
  server,
  getRealtime: () => realtime,
  closeDb: () => pool.end(),
  closeRedis: () => redis.close(),
  logger,
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Une promesse rejetée sans traitement est un bug : on la journalise sans
// arrêter le serveur, qui sert d'autres joueurs.
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'promesse rejetée non traitée');
});
