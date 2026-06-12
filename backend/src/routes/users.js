'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validatePassword } = require('../services/passwordPolicy');
const config = require('../config');

const router = express.Router();

// ─── GET /api/users/me ────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.email, u.created_at,
              u.rating_classic, u.rating_mondoubleau,
              COALESCE(stats.wins, 0)   AS wins,
              COALESCE(stats.losses, 0) AS losses,
              COALESCE(stats.plays, 0)  AS plays
       FROM users u
       LEFT JOIN (
         SELECT gp.user_id,
                COUNT(*) FILTER (WHERE gp.won = TRUE)  AS wins,
                COUNT(*) FILTER (WHERE gp.won = FALSE) AS losses,
                COUNT(*)                                AS plays
         FROM game_players gp
         WHERE gp.user_id = $1
         GROUP BY gp.user_id
       ) stats ON stats.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const u = rows[0];
    res.json({
      id: u.id,
      username: u.username,
      email: u.email,
      joined: u.created_at,
      stats: {
        wins: Number(u.wins),
        losses: Number(u.losses),
        plays: Number(u.plays),
      },
      ratings: {
        classic: Number(u.rating_classic),
        mondoubleau: Number(u.rating_mondoubleau),
      },
    });
  } catch (err) {
    console.error('GET /users/me error:', err);
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── GET /api/users/search?q=pseudo ──────────────────────────────────────────

router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(422).json({ error: 'Recherche trop courte (2 caractères min).' });
  }

  try {
    const { rows } = await query(
      `SELECT u.id, u.username,
              COALESCE(stats.wins, 0) AS wins,
              COALESCE(stats.plays, 0) AS plays,
              f.status AS friendship_status,
              f.requester_id AS friendship_requester
       FROM users u
       LEFT JOIN (
         SELECT gp.user_id,
                COUNT(*) FILTER (WHERE gp.won = TRUE) AS wins,
                COUNT(*) AS plays
         FROM game_players gp GROUP BY gp.user_id
       ) stats ON stats.user_id = u.id
       LEFT JOIN friendships f ON (
         (f.requester_id = $1 AND f.addressee_id = u.id) OR
         (f.addressee_id = $1 AND f.requester_id = u.id)
       )
       WHERE u.id <> $1
         AND u.email_verified = TRUE
         AND u.username ILIKE $2
       ORDER BY u.username
       LIMIT 20`,
      [req.user.id, `%${q}%`]
    );
    res.json(rows.map(u => ({
      id: u.id,
      username: u.username,
      wins: Number(u.wins),
      plays: Number(u.plays),
      friendshipStatus: u.friendship_status || null,
      friendshipRequester: u.friendship_requester || null,
    })));
  } catch (err) {
    console.error('GET /users/search error:', err);
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── GET /api/users/history ───────────────────────────────────────────────────

router.get('/history', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT g.id, g.mode, g.variant, g.player_count, g.target_score,
              g.created_at AS date, g.ended_at,
              gp_me.score AS my_score, gp_me.won,
              (
                SELECT STRING_AGG(
                  COALESCE(u2.username, gp2.guest_name), ', '
                  ORDER BY gp2.seat
                )
                FROM game_players gp2
                LEFT JOIN users u2 ON u2.id = gp2.user_id
                WHERE gp2.game_id = g.id AND gp2.user_id <> $1
              ) AS opponents
       FROM games g
       JOIN game_players gp_me ON gp_me.game_id = g.id AND gp_me.user_id = $1
       WHERE g.ended_at IS NOT NULL
       ORDER BY g.ended_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /users/history error:', err);
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── POST /api/users/me/password ──────────────────────────────────────────────
// Changement de mot de passe par un utilisateur connecté (#108) : exige le mot
// de passe actuel, applique la politique, et refuse un nouveau identique.

router.post('/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(422).json({ error: 'Mot de passe actuel et nouveau requis.' });
  }
  const pwdError = validatePassword(newPassword);
  if (pwdError) return res.status(422).json({ error: pwdError });
  if (newPassword === currentPassword) {
    return res.status(422).json({ error: 'Le nouveau mot de passe doit être différent de l’actuel.' });
  }

  try {
    const { rows } = await query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(403).json({ error: 'Mot de passe actuel incorrect.' });

    const passwordHash = await bcrypt.hash(newPassword, config.auth.bcryptRounds);
    await query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [passwordHash, req.user.id]
    );
    res.json({ message: 'Mot de passe modifié.' });
  } catch (err) {
    console.error('POST /users/me/password error:', err);
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

module.exports = router;
