'use strict';

// Enregistre une partie PvP **terminée et arbitrée par le serveur**, et met à
// jour l'Elo des deux joueurs (par variante) dans une transaction. C'est le
// pendant *autoritatif* de la branche online de routes/games.js : ici le
// résultat ne provient pas du client mais de la GameSession serveur.

const { withTransaction } = require('../db');
const { computePairUpdate } = require('./elo');
const { evaluateAchievements } = require('./achievements');

function ratingColumn(variant) {
  return variant === 'mondoubleau' ? 'rating_mondoubleau' : 'rating_classic';
}

/**
 * @param {object} outcome  Issu de GameSession.getMatchOutcome() (+ sessionId)
 *   { variant, target, players: [{ userId, seat, score, won }, ...] }
 * @returns {Promise<{ gameId, ratings }|null>}
 */
async function recordMatch(outcome) {
  const variant = outcome.variant === 'mondoubleau' ? 'mondoubleau' : 'classic';
  const rated = (outcome.players || []).filter(p => p.userId);
  if (rated.length !== 2) return null; // v1 : seules les parties 1v1 sont classées

  const col = ratingColumn(variant);
  const [a, b] = rated;

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO games (mode, variant, player_count, target_score, ended_at)
       VALUES ('online', $1, 2, $2, NOW())
       RETURNING id`,
      [variant, outcome.target || 3]
    );
    const gameId = rows[0].id;

    const ids = [a.userId, b.userId];
    const cur = await client.query(
      `SELECT id, ${col} AS rating FROM users WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [ids]
    );
    const before = new Map(cur.rows.map(r => [r.id, r.rating]));

    // Pas d'Elo si un compte a disparu, ni pour une partie AMICALE (#47) —
    // la partie est enregistrée dans tous les cas (rating_before/after NULL).
    const canRate = before.has(a.userId) && before.has(b.userId) && outcome.rated !== false;
    const updated = canRate
      ? computePairUpdate(before.get(a.userId), before.get(b.userId), a.won === true)
      : null;
    const nextRating = (userId) =>
      updated ? (userId === a.userId ? updated.a : updated.b) : null;

    const ratings = [];
    for (const pl of rated) {
      const rb = before.has(pl.userId) ? before.get(pl.userId) : null;
      const ra = nextRating(pl.userId);
      await client.query(
        `INSERT INTO game_players (game_id, user_id, seat, score, won, rating_before, rating_after)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [gameId, pl.userId, pl.seat, pl.score, pl.won, rb, ra]
      );
      if (updated) {
        await client.query(`UPDATE users SET ${col} = $1 WHERE id = $2`, [ra, pl.userId]);
        ratings.push({ userId: pl.userId, before: rb, after: ra });
      }
    }

    // Badges (#217) : évalués après l'enregistrement + l'Elo, dans la même
    // transaction (stats à jour). Côté serveur uniquement, idempotent.
    for (const pl of rated) {
      await evaluateAchievements(client, pl.userId);
    }

    return { gameId, ratings: updated ? ratings : null };
  });
}

/** Lit l'Elo d'un joueur pour une variante (défaut 1500 si introuvable). */
async function getRating(query, userId, variant) {
  const col = ratingColumn(variant);
  const { rows } = await query(`SELECT ${col} AS rating FROM users WHERE id = $1`, [userId]);
  return rows.length ? Number(rows[0].rating) : 1500;
}

module.exports = { recordMatch, getRating, ratingColumn };
