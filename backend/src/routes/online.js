'use strict';

// ─── GET /api/online ──────────────────────────────────────────────────────────
// Compteurs de présence publics (#43) : joueurs connectés au temps réel, en
// file d'attente, en partie. Sert aux visiteurs non connectés au WebSocket
// (les connectés reçoivent les mêmes chiffres en push via `t:'presence'`).
// Compteurs uniquement, jamais d'identité.

const express = require('express');
const { getPresence } = require('../realtime/presence');

const router = express.Router();

router.get('/', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=10');
  res.json(getPresence());
});

module.exports = router;
