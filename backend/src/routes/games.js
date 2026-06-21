'use strict';

const express = require('express');
const { withTransaction } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { evaluateAchievements } = require('../services/achievements');

const router = express.Router();

// Les parties « online » sont enregistrées PAR LE SERVEUR (wsServer →
// matchRecorder), jamais par cette route (#116) : accepter des résultats
// online déclarés par le client permettrait de falsifier l'Elo et
// l'historique d'autrui (les UUID des joueurs sont publics via la recherche).
const VALID_MODES = ['ai', 'local', 'friend'];
const VALID_VARIANTS = ['classic', 'mondoubleau'];

// ─── POST /api/games ──────────────────────────────────────────────────────────
// Enregistre le résultat d'une partie LOCALE terminée (ai/local/friend). Seul
// l'appelant peut y être rattaché comme vrai utilisateur — les autres sièges
// sont des invités. Aucune mise à jour d'Elo ici (réservée au serveur PvP).

router.post('/', requireAuth, async (req, res) => {
  const { mode, variant, playerCount, targetScore, difficulty, players } = req.body;
  const variantSafe = variant || 'classic';

  if (!VALID_MODES.includes(mode))
    return res.status(422).json({ error: 'Mode invalide.' });
  if (!VALID_VARIANTS.includes(variantSafe))
    return res.status(422).json({ error: 'Variante invalide.' });
  if (![2, 3, 4].includes(Number(playerCount)))
    return res.status(422).json({ error: 'Nombre de joueurs invalide (2, 3 ou 4).' });
  if (![3, 5].includes(Number(targetScore)))
    return res.status(422).json({ error: 'Objectif invalide (3 ou 5 parties).' });
  if (!Array.isArray(players) || players.length < 2)
    return res.status(422).json({ error: 'La liste des joueurs est requise.' });

  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO games (mode, variant, player_count, target_score, difficulty, ended_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        [mode, variantSafe, Number(playerCount), Number(targetScore), difficulty || null]
      );
      const gid = rows[0].id;

      // Identité des sièges : seul l'appelant peut être un vrai utilisateur,
      // tout autre siège est un invité (#116) — impossible de rattacher un
      // résultat à un tiers.
      const seats = players.map((p, seat) => {
        const userId = p.userId === req.user.id ? req.user.id : null;
        return {
          seat,
          userId,
          guestName: userId ? null : (p.guestName || `Joueur ${seat + 1}`),
          score: p.score != null ? Number(p.score) : null,
          won: typeof p.won === 'boolean' ? p.won : null,
        };
      });

      for (const s of seats) {
        await client.query(
          `INSERT INTO game_players (game_id, user_id, guest_name, seat, score, won)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [gid, s.userId, s.guestName, s.seat, s.score, s.won]
        );
      }

      // Badges (#217) : seul l'appelant est un vrai utilisateur ici ; on évalue
      // ses badges dans la même transaction (stats à jour), côté serveur.
      await evaluateAchievements(client, req.user.id);

      return { gid };
    });

    res.status(201).json({ id: result.gid });
  } catch (err) {
    req.log.error({ err }, 'POST /games');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

module.exports = router;
