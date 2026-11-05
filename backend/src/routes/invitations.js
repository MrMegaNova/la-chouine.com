'use strict';

const express = require('express');
const { query } = require('../db');
const { findInviter } = require('../services/invitations');

const router = express.Router();

// ─── GET /api/invitations/:code ───────────────────────────────────────────────

// Route publique (#295) : ne renvoie que le pseudo, jamais l'identifiant.
router.get('/:code', async (req, res) => {
  try {
    const inviter = await findInviter(query, req.params.code);
    if (!inviter) return res.status(404).json({ error: 'Invitation introuvable.' });
    res.json({ username: inviter.username });
  } catch (err) {
    req.log.error({ err }, 'GET /invitations/:code');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

module.exports = router;
