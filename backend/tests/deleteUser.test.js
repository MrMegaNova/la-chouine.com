'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

// Domaine dédié à ce fichier (tests en parallèle sur la même base).
const DOMAIN = '@deluser.invalid';

async function cleanup() {
  await pool.query(
    `DELETE FROM games WHERE id IN (
       SELECT game_id FROM game_players gp
       JOIN users u ON u.id = gp.user_id
       WHERE u.email LIKE '%' || $1)`,
    [DOMAIN]
  );
  await pool.query(`DELETE FROM users WHERE email LIKE '%' || $1`, [DOMAIN]);
}

before(cleanup);
after(async () => { await cleanup(); await pool.end(); });

test('supprimer un utilisateur ayant des parties pseudonymise ses sièges (#134)', async () => {
  const hash = await bcrypt.hash('Motdepasse123!', 12);
  const { rows: u } = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, TRUE) RETURNING id`,
    ['DelUser', `deluser${DOMAIN}`, hash]
  );
  const userId = u[0].id;

  // Une partie online où ce joueur affronte un invité.
  const { rows: g } = await pool.query(
    `INSERT INTO games (mode, variant, player_count, target_score, ended_at)
     VALUES ('online', 'classic', 2, 3, NOW()) RETURNING id`
  );
  const gameId = g[0].id;
  await pool.query(
    `INSERT INTO game_players (game_id, user_id, guest_name, seat, score, won)
     VALUES ($1, $2, NULL, 0, 3, TRUE), ($1, NULL, 'Adversaire', 1, 1, FALSE)`,
    [gameId, userId]
  );

  // La suppression ne doit PAS violer must_have_identity (le bug de #134).
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

  // Le siège du joueur supprimé est conservé comme invité portant son pseudo.
  const { rows } = await pool.query(
    `SELECT user_id, guest_name FROM game_players WHERE game_id = $1 AND seat = 0`,
    [gameId]
  );
  assert.equal(rows[0].user_id, null, 'le lien utilisateur est dénoué');
  assert.equal(rows[0].guest_name, 'DelUser', 'le pseudo est conservé en invité (pseudonymisation)');

  // L'historique de l'adversaire reste lisible (la partie existe toujours).
  const { rows: still } = await pool.query(`SELECT 1 FROM games WHERE id = $1`, [gameId]);
  assert.equal(still.length, 1, 'la partie n’est pas supprimée');
});

test('supprimer un utilisateur sans partie fonctionne aussi (#134)', async () => {
  const hash = await bcrypt.hash('Motdepasse123!', 12);
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, TRUE) RETURNING id`,
    ['DelUser2', `deluser2${DOMAIN}`, hash]
  );
  await pool.query(`DELETE FROM users WHERE id = $1`, [rows[0].id]);
  const { rows: gone } = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [rows[0].id]);
  assert.equal(gone.length, 0);
});
