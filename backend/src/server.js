'use strict';

const http = require('http');
const app = require('./app');
const config = require('./config');
const { logger } = require('./logger');
const { verifyTransport } = require('./services/email');
const { checkTokenVersion } = require('./middleware/auth');
const { attachWebSocketServer } = require('./realtime/wsServer');
const redis = require('./redis/client');

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
  await attachWebSocketServer(server, { validateUser: checkTokenVersion });

  server.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'Serveur démarré');
    // Vérifie la connexion SMTP au démarrage pour rendre un problème de conf mail
    // immédiatement visible dans les logs (non bloquant pour le serveur HTTP).
    verifyTransport();
  });
})();

server.on('error', (err) => {
  logger.fatal({ err }, 'Erreur serveur HTTP');
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM reçu — arrêt propre');
  server.close(() => process.exit(0));
});
