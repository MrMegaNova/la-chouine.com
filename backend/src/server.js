'use strict';

const http = require('http');
const app = require('./app');
const config = require('./config');
const { logger } = require('./logger');
const { verifyTransport } = require('./services/email');
const { checkTokenVersion, currentTokenVersions } = require('./middleware/auth');
const { attachWebSocketServer } = require('./realtime/wsServer');
const redis = require('./redis/client');
const { query } = require('./db');
const { purgeOldIps } = require('./services/visits');

const server = http.createServer(app);

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
  await attachWebSocketServer(server, { validateUser: checkTokenVersion, currentTokenVersions });

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

process.on('SIGTERM', () => {
  logger.info('SIGTERM reçu — arrêt propre');
  server.close(() => process.exit(0));
});
