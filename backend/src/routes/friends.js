'use strict';

const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notifyUser } = require('../realtime/notifier');
const { userPresence } = require('../realtime/presence');

const router = express.Router();

// ─── GET /api/friends ─────────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.avatar,
              COALESCE(stats.wins, 0)  AS wins,
              COALESCE(stats.plays, 0) AS plays
       FROM friendships f
       JOIN users u ON u.id = CASE
         WHEN f.requester_id = $1 THEN f.addressee_id
         ELSE f.requester_id
       END
       LEFT JOIN (
         SELECT gp.user_id,
                COUNT(*) FILTER (WHERE gp.won = TRUE) AS wins,
                COUNT(*) AS plays
         FROM game_players gp GROUP BY gp.user_id
       ) stats ON stats.user_id = u.id
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'accepted'
       ORDER BY u.username`,
      [req.user.id]
    );
    // Pastille de présence (#46) : uniquement ici, entre amis acceptés —
    // jamais dans la recherche d'utilisateurs ni le classement.
    res.json(rows.map(r => ({
      id: r.id,
      username: r.username,
      avatar: r.avatar || null,
      wins: Number(r.wins),
      plays: Number(r.plays),
      ...userPresence(r.id),
    })));
  } catch (err) {
    req.log.error({ err }, 'GET /friends');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── GET /api/friends/requests ────────────────────────────────────────────────

router.get('/requests', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT f.id AS friendship_id, u.id, u.username
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, 'GET /friends/requests');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── POST /api/friends/request ────────────────────────────────────────────────

router.post('/request', requireAuth, async (req, res) => {
  const { targetId } = req.body;
  if (!targetId || typeof targetId !== 'string') {
    return res.status(422).json({ error: 'targetId requis.' });
  }
  if (targetId === req.user.id) {
    return res.status(422).json({ error: 'Impossible de s\'ajouter soi-même.' });
  }

  try {
    const target = await query(
      `SELECT id FROM users WHERE id = $1 AND email_verified = TRUE`,
      [targetId]
    );
    if (!target.rows.length) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    // Vérifier si une relation existe déjà (dans les deux sens)
    const existing = await query(
      `SELECT status, requester_id FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [req.user.id, targetId]
    );
    if (existing.rows.length) {
      const rel = existing.rows[0];
      if (rel.status === 'accepted') {
        return res.status(409).json({ error: 'Vous êtes déjà amis.' });
      }
      // Si c'est l'autre qui avait envoyé une demande : accepter directement
      if (rel.status === 'pending' && rel.requester_id === targetId) {
        await query(
          `UPDATE friendships SET status = 'accepted', updated_at = NOW()
           WHERE requester_id = $1 AND addressee_id = $2`,
          [targetId, req.user.id]
        );
        return res.json({ message: 'Demande acceptée automatiquement.' });
      }
      return res.status(409).json({ error: 'Demande déjà envoyée.' });
    }

    await query(
      `INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)`,
      [req.user.id, targetId]
    );
    // Temps réel (#44) : prévient le destinataire s'il est connecté ; sinon le
    // badge alimenté par GET /friends/requests prendra le relais.
    notifyUser(targetId, { kind: 'friendRequest', from: req.user.username });
    res.status(201).json({ message: 'Demande d\'ami envoyée.' });
  } catch (err) {
    req.log.error({ err }, 'POST /friends/request');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── POST /api/friends/accept ─────────────────────────────────────────────────

router.post('/accept', requireAuth, async (req, res) => {
  const { requesterId } = req.body;
  if (!requesterId) return res.status(422).json({ error: 'requesterId requis.' });

  try {
    const { rows } = await query(
      `UPDATE friendships SET status = 'accepted', updated_at = NOW()
       WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'
       RETURNING id`,
      [requesterId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Demande introuvable.' });
    res.json({ message: 'Ami ajouté.' });
  } catch (err) {
    req.log.error({ err }, 'POST /friends/accept');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── POST /api/friends/decline ────────────────────────────────────────────────

router.post('/decline', requireAuth, async (req, res) => {
  const { requesterId } = req.body;
  if (!requesterId) return res.status(422).json({ error: 'requesterId requis.' });

  try {
    await query(
      `UPDATE friendships SET status = 'declined', updated_at = NOW()
       WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
      [requesterId, req.user.id]
    );
    res.json({ message: 'Demande refusée.' });
  } catch (err) {
    req.log.error({ err }, 'POST /friends/decline');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// ─── DELETE /api/friends/:id ──────────────────────────────────────────────────

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await query(
      `DELETE FROM friendships
       WHERE ((requester_id = $1 AND addressee_id = $2)
           OR (requester_id = $2 AND addressee_id = $1))
         AND status = 'accepted'`,
      [req.user.id, req.params.id]
    );
    res.json({ message: 'Ami retiré.' });
  } catch (err) {
    req.log.error({ err }, 'DELETE /friends/:id');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

module.exports = router;
