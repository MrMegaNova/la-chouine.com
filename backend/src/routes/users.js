'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { requireAuth, signToken } = require('../middleware/auth');
const { validatePassword } = require('../services/passwordPolicy');
const config = require('../config');

const router = express.Router();

// ─── GET /api/users/me ────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.email, u.created_at, u.avatar,
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
      avatar: u.avatar || null,
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
    req.log.error({ err }, 'GET /users/me');
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
      `SELECT u.id, u.username, u.avatar,
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
      avatar: u.avatar || null,
      wins: Number(u.wins),
      plays: Number(u.plays),
      friendshipStatus: u.friendship_status || null,
      friendshipRequester: u.friendship_requester || null,
    })));
  } catch (err) {
    req.log.error({ err }, 'GET /users/search');
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
    req.log.error({ err }, 'GET /users/history');
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
    // token_version + 1 révoque tous les JWT émis avant (#117) — y compris
    // celui de cette session : on en réémet un frais dans la réponse pour ne
    // pas déconnecter l'utilisateur qui vient de changer son mot de passe.
    const { rows: upd } = await query(
      `UPDATE users SET password_hash = $1, token_version = token_version + 1,
              updated_at = NOW()
       WHERE id = $2
       RETURNING username, token_version`,
      [passwordHash, req.user.id]
    );
    const fresh = signToken({
      id: req.user.id,
      username: upd[0].username,
      token_version: upd[0].token_version,
    });
    res.json({ message: 'Mot de passe modifié.', token: fresh });
  } catch (err) {
    req.log.error({ err }, 'POST /users/me/password');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── Avatar (#87) ─────────────────────────────────────────────────────────────
// Stocké en data URL (base64) : image petite et carrée redimensionnée côté
// client. Validation stricte du format et de la taille (le ré-encodage canvas
// côté client retire aussi l'EXIF).

const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const AVATAR_MAX = 60_000; // ~44 Ko binaire, sous la limite JSON globale (64 Ko)

router.post('/me/avatar', requireAuth, async (req, res) => {
  const { avatar } = req.body || {};
  if (typeof avatar !== 'string' || !AVATAR_RE.test(avatar)) {
    return res.status(422).json({ error: 'Image invalide (png, jpeg ou webp attendu).' });
  }
  if (avatar.length > AVATAR_MAX) {
    return res.status(413).json({ error: 'Image trop lourde (réduisez sa taille).' });
  }
  try {
    await query(`UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2`,
      [avatar, req.user.id]);
    res.json({ avatar });
  } catch (err) {
    req.log.error({ err }, 'POST /users/me/avatar');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

router.delete('/me/avatar', requireAuth, async (req, res) => {
  try {
    await query(`UPDATE users SET avatar = NULL, updated_at = NOW() WHERE id = $1`,
      [req.user.id]);
    res.json({ avatar: null });
  } catch (err) {
    req.log.error({ err }, 'DELETE /users/me/avatar');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

module.exports = router;
