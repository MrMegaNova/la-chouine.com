'use strict';

const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── POST /api/games ──────────────────────────────────────────────────────────
// Enregistre le résultat d'une partie terminée.

router.post('/', requireAuth, async (req, res) => {
  const { mode, variant, playerCount, targetScore, difficulty, players } = req.body;

  const VALID_MODES = ['ai', 'local', 'online', 'friend'];
  const VALID_VARIANTS = ['classic', 'mondoubleau'];

  if (!VALID_MODES.includes(mode))
    return res.status(422).json({ error: 'Mode invalide.' });
  if (!VALID_VARIANTS.includes(variant || 'classic'))
    return res.status(422).json({ error: 'Variante invalide.' });
  if (![2, 3, 4].includes(Number(playerCount)))
    return res.status(422).json({ error: 'Nombre de joueurs invalide (2, 3 ou 4).' });
  if (![3, 5].includes(Number(targetScore)))
    return res.status(422).json({ error: 'Objectif invalide (3 ou 5 parties).' });
  if (!Array.isArray(players) || players.length < 2)
    return res.status(422).json({ error: 'La liste des joueurs est requise.' });

  try {
    const gameId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO games (mode, variant, player_count, target_score, difficulty, ended_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        [mode, variant || 'classic', Number(playerCount), Number(targetScore), difficulty || null]
      );
      const gid = rows[0].id;

      for (const [seat, p] of players.entries()) {
        const userId = p.userId === req.user.id ? req.user.id : null;
        await client.query(
          `INSERT INTO game_players (game_id, user_id, guest_name, seat, score, won)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            gid,
            userId,
            userId ? null : (p.guestName || `Joueur ${seat + 1}`),
            seat,
            p.score != null ? Number(p.score) : null,
            typeof p.won === 'boolean' ? p.won : null,
          ]
        );
      }
      return gid;
    });

    res.status(201).json({ id: gameId });
  } catch (err) {
    console.error('POST /games error:', err);
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

module.exports = router;
