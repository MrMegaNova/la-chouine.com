'use strict';

// Logs structurés (#130) — pino. JSON en production (exploitable derrière
// Traefik), joli en développement. Redaction des champs sensibles : aucun mot
// de passe, token ou en-tête d'autorisation ne doit fuir dans les logs.
// Silencieux en test pour ne pas polluer la sortie des suites.

const pino = require('pino');
const config = require('./config');

// Champs censurés où qu'ils apparaissent dans un objet loggé.
const redact = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'password', '*.password',
    'currentPassword', '*.currentPassword',
    'newPassword', '*.newPassword',
    'token', '*.token',
    'verifyToken', 'resetToken',
    'avatar', '*.avatar', // data URL d'image — volumineux et inutile en log
  ],
  censor: '[redacted]',
};

const level = config.isTest
  ? 'silent'
  : (process.env.LOG_LEVEL || (config.isProd ? 'info' : 'debug'));

const logger = pino({
  level,
  redact,
  base: { service: 'la-chouine' },
  // Sortie lisible (pino-pretty) dans tous les environnements sauf test —
  // jamais de JSON brut. Couleurs en dev ; sans couleur en prod (sortie
  // capturée par Docker, pas de TTY).
  ...(config.isTest ? {} : {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: !config.isProd,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname,service',
      },
    },
  }),
});

module.exports = { logger, redact };
