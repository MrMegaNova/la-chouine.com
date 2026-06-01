'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const { authLimiter, apiLimiter } = require('./middleware/rateLimiter');

const authRoutes    = require('./routes/auth');
const usersRoutes   = require('./routes/users');
const friendsRoutes = require('./routes/friends');
const gamesRoutes   = require('./routes/games');

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

// ─── Parsing ──────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '64kb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth',    authLimiter, authRoutes);
app.use('/api/users',   apiLimiter,  usersRoutes);
app.use('/api/friends', apiLimiter,  friendsRoutes);
app.use('/api/games',   apiLimiter,  gamesRoutes);

// ─── 404 / erreur globale ─────────────────────────────────────────────────────

app.use((_req, res) => res.status(404).json({ error: 'Endpoint introuvable.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Erreur non gérée :', err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

module.exports = app;
