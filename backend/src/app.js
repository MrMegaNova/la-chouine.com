'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const config = require('./config');
const { logger, redact } = require('./logger');
const { authLimiter, apiLimiter } = require('./middleware/rateLimiter');

const authRoutes    = require('./routes/auth');
const usersRoutes   = require('./routes/users');
const friendsRoutes = require('./routes/friends');
const gamesRoutes   = require('./routes/games');
const onlineRoutes  = require('./routes/online');

const app = express();

// ─── Sécurité ─────────────────────────────────────────────────────────────────

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: config.isProd ? undefined : false,
}));

app.use(cors({
  origin: config.isProd
    ? [config.frontend.url]
    : ['http://localhost:3000', 'http://localhost:5500', config.frontend.url],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Journalisation des requêtes (#130) ──────────────────────────────────────
// Un log par requête (méthode, URL, statut, durée) avec id de corrélation ;
// redaction des en-têtes/corps sensibles. `req.log` est dispo dans les routes.
app.use(pinoHttp({
  logger,
  redact,
  // Le corps n'est pas loggé par défaut ; on garde un bruit minimal.
  autoLogging: { ignore: (req) => req.url === '/api/health' },
}));

// ─── Parsing ──────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '64kb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth',    authLimiter, authRoutes);
app.use('/api/users',   apiLimiter,  usersRoutes);
app.use('/api/friends', apiLimiter,  friendsRoutes);
app.use('/api/games',   apiLimiter,  gamesRoutes);
app.use('/api/online',  apiLimiter,  onlineRoutes);

// ─── 404 / erreur globale ─────────────────────────────────────────────────────

app.use((_req, res) => res.status(404).json({ error: 'Endpoint introuvable.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  (req.log || logger).error({ err }, 'Erreur non gérée');
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

module.exports = app;
