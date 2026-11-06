'use strict';

const { requireAuth } = require('./auth');

/**
 * Réservé aux administrateurs (#311) : session valide (requireAuth, avec
 * token_version), puis `users.is_admin` relu en base à chaque requête, pour
 * qu'un retrait du droit prenne effet immédiatement.
 */
async function checkAdmin(req, res, next) {
  try {
    const { query } = require('../db');
    const { rows } = await query(`SELECT is_admin FROM users WHERE id = $1`, [req.user.id]);
    if (!rows[0]?.is_admin) return res.status(403).json({ error: 'Accès réservé.' });
    next();
  } catch (err) {
    req.log.error({ err }, 'requireAdmin');
    res.status(500).json({ error: 'Erreur interne.' });
  }
}

const requireAdmin = [requireAuth, checkAdmin];

module.exports = { requireAdmin };
