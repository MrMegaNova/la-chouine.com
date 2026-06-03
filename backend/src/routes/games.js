'use strict';

const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { computePairUpdate } = require('../services/elo');

const router = express.Router();

const VALID_MODES = ['ai', 'local', 'online', 'friend'];
const VALID_VARIANTS = ['classic', 'mondoubleau'];

// Colonne de note correspondant à la variante jouée.
function ratingColumn(variant) {
  return variant === 'mondoubleau' ? 'rating_mondoubleau' : 'rating_classic';
}

// ─── POST /api/games ──────────────────────────────────────────────────────────
// Enregistre le résultat d'une partie terminée. Pour les parties `online` à deux
// vrais joueurs, met à jour leur Elo (par variante) dans la même transaction.

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
    // En mode online, plusieurs vrais utilisateurs peuvent participer : on valide
    // que chaque user_id référencé existe réellement. Dans les autres modes, seul
    // l'appelant est un vrai utilisateur (les autres sièges sont des invités).
    let realUserIds = new Set();
    if (mode === 'online') {
      const referenced = [...new Set(
        players.map(p => p.userId).filter(Boolean)
      )];
      if (referenced.length) {
        const { rows } = await query(
          'SELECT id FROM users WHERE id = ANY($1::uuid[])',
          [referenced]
        );
        realUserIds = new Set(rows.map(r => r.id));
      }
      // Un utilisateur ne peut soumettre qu'une partie à laquelle il a participé.
      if (!realUserIds.has(req.user.id)) {
        return res.status(403).json({ error: 'Vous ne participez pas à cette partie.' });
      }
    }

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO games (mode, variant, player_count, target_score, difficulty, ended_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        [mode, variantSafe, Number(playerCount), Number(targetScore), difficulty || null]
      );
      const gid = rows[0].id;

      // Résout l'identité de chaque siège (vrai utilisateur ou invité).
      const seats = players.map((p, seat) => {
        let userId = null;
        if (mode === 'online') {
          userId = realUserIds.has(p.userId) ? p.userId : null;
        } else {
          userId = p.userId === req.user.id ? req.user.id : null;
        }
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

      // ── Mise à jour Elo : uniquement les parties online à 2 vrais joueurs ──
      let ratings = null;
      const rated = seats.filter(s => s.userId);
      const decisive =
        rated.length === 2 &&
        rated.filter(s => s.won === true).length === 1 &&
        rated.filter(s => s.won === false).length === 1;

      if (mode === 'online' && decisive) {
        const col = ratingColumn(variantSafe);
        const [a, b] = rated;
        // Verrouille les deux lignes pour un calcul cohérent en cas de concurrence.
        const { rows: cur } = await client.query(
          `SELECT id, ${col} AS rating FROM users WHERE id = ANY($1::uuid[]) FOR UPDATE`,
          [[a.userId, b.userId]]
        );
        const before = new Map(cur.map(r => [r.id, r.rating]));
        const updated = computePairUpdate(
          before.get(a.userId),
          before.get(b.userId),
          a.won === true
        );
        const next = { [a.userId]: updated.a, [b.userId]: updated.b };

        for (const s of rated) {
          await client.query(
            `UPDATE users SET ${col} = $1 WHERE id = $2`,
            [next[s.userId], s.userId]
          );
          await client.query(
            `UPDATE game_players SET rating_before = $1, rating_after = $2
             WHERE game_id = $3 AND user_id = $4`,
            [before.get(s.userId), next[s.userId], gid, s.userId]
          );
        }
        ratings = rated.map(s => ({
          userId: s.userId,
          before: before.get(s.userId),
          after: next[s.userId],
        }));
      }

      return { gid, ratings };
    });

    res.status(201).json({ id: result.gid, ratings: result.ratings });
  } catch (err) {
    console.error('POST /games error:', err);
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

module.exports = router;
