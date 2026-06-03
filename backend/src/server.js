'use strict';

const http = require('http');
const app = require('./app');
const config = require('./config');
const { verifyTransport } = require('./services/email');
const { attachWebSocketServer } = require('./realtime/wsServer');

const server = http.createServer(app);

// Transport temps-réel PvP (WebSocket sur /ws), greffé sur le même serveur HTTP.
attachWebSocketServer(server);

server.listen(config.port, () => {
  console.log(`[la-chouine] Serveur démarré sur le port ${config.port} (${config.nodeEnv})`);
  // Vérifie la connexion SMTP au démarrage pour rendre un problème de conf mail
  // immédiatement visible dans les logs (non bloquant pour le serveur HTTP).
  verifyTransport();
});

server.on('error', (err) => {
  console.error('Erreur serveur HTTP :', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM reçu — arrêt propre');
  server.close(() => process.exit(0));
});
