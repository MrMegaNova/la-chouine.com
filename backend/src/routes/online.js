'use strict';

// ─── GET /api/online ──────────────────────────────────────────────────────────
// Compteurs de présence publics (#43) : joueurs connectés au temps réel, en
// file d'attente, en partie. Agrégés depuis Redis (#31, multi-instance). Sert
// aux visiteurs non connectés au WebSocket (les connectés reçoivent les mêmes
// chiffres en push via `t:'presence'`). Compteurs uniquement, jamais d'identité.

const express = require('express');
const { counts } = require('../realtime/presenceStore');

const router = express.Router();

router.get('/', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=10');
  res.json(await counts());
});

module.exports = router;
