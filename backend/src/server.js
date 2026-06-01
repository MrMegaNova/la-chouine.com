'use strict';

const http = require('http');
const app = require('./app');
const config = require('./config');

const server = http.createServer(app);

server.listen(config.port, () => {
  console.log(`[la-chouine] Serveur démarré sur le port ${config.port} (${config.nodeEnv})`);
});

server.on('error', (err) => {
  console.error('Erreur serveur HTTP :', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM reçu — arrêt propre');
  server.close(() => process.exit(0));
});
