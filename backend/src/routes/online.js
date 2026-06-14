'use strict';

// ─── GET /api/online ──────────────────────────────────────────────────────────
// Compteurs de présence publics (#43) : joueurs connectés au temps réel, en
// file d'attente, en partie. Agrégés depuis Redis (#31, multi-instance). Sert
// aux visiteurs non connectés au WebSocket (les connectés reçoivent les mêmes
// chiffres en push via `t:'presence'`). Compteurs uniquement, jamais d'identité.

const express = require('express');
const { counts } = require('../realtime/presenceStore');
const { requireAuth } = require('../middleware/auth');
const { issue } = require('../realtime/ticketStore');

const router = express.Router();

router.get('/', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=10');
  res.json(await counts());
});

// ─── POST /api/online/ws-ticket (#120) ────────────────────────────────────────
// Émet un ticket éphémère à usage unique pour ouvrir le WebSocket sans mettre le
// JWT dans l'URL (fuite dans les logs des proxys). À redemander à chaque
// (re)connexion. Authentifié : le ticket porte l'identité du porteur du JWT.
router.post('/ws-ticket', requireAuth, async (req, res) => {
  res.json({ ticket: await issue(req.user) });
});

module.exports = router;
