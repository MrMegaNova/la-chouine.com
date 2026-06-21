'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { signToken } = require('../src/middleware/auth');
const { evaluateAchievements, listAchievements } = require('../src/services/achievements');
const app = require('../src/app');

const request = supertest(app);
// Domaine email dédié au fichier (isolation des tests parallèles, cf. CLAUDE.md).
const DOMAIN = 'achievements.invalid';
let userId;
let token;

async function cleanup() {
  // Supprimer les games d'abord (FK game_players → games ON DELETE CASCADE) :
  // les sièges partent avec, pas de game orphelin.
  await pool.query(`DELETE FROM games WHERE id IN (
    SELECT game_id FROM game_players WHERE user_id IN (SELECT id FROM users WHERE email ILIKE $1)
  )`, [`%@${DOMAIN}`]);
  // user_achievements cascade à la suppression de l'utilisateur, mais on nettoie
  // explicitement pour un état propre entre exécutions.
  await pool.query(`DELETE FROM user_achievements WHERE user_id IN (SELECT id FROM users WHERE email ILIKE $1)`, [`%@${DOMAIN}`]);
  await pool.query(`DELETE FROM users WHERE email ILIKE $1`, [`%@${DOMAIN}`]);
}

// Crée une partie online et y assoit le joueur avec le résultat voulu.
async function addGame(won) {
  const g = await pool.query(`INSERT INTO games (mode, variant, ended_at) VALUES ('online','classic', NOW()) RETURNING id`);
  await pool.query(
    `INSERT INTO game_players (game_id, user_id, seat, score, won) VALUES ($1, $2, 0, $3, $4)`,
    [g.rows[0].id, userId, won ? 3 : 1, won]);
}

before(async () => {
  await cleanup();
  const hash = await bcrypt.hash('Motdepasse123!', 12);
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified) VALUES ($1, $2, $3, TRUE) RETURNING id, username`,
    ['AchUser', `ach@${DOMAIN}`, hash]);
  userId = rows[0].id;
  token = signToken({ id: userId, username: rows[0].username });
});

after(async () => {
  await cleanup();
  await pool.end();
});

test('aucune partie : aucun badge', async () => {
  const got = await evaluateAchievements(pool, userId);
  assert.deepEqual(got, []);
  assert.deepEqual(await listAchievements((q, p) => pool.query(q, p), userId), []);
});

test('1ʳᵉ partie gagnée : débloque première partie + première victoire', async () => {
  await addGame(true);
  const got = await evaluateAchievements(pool, userId);
  assert.ok(got.includes('premiere-partie'));
  assert.ok(got.includes('premiere-victoire'));
});

test('idempotence : ré-évaluer ne re-débloque pas (RETURNING vide)', async () => {
  const got = await evaluateAchievements(pool, userId);
  assert.deepEqual(got, [], 'aucun nouveau badge');
  // La liste reste cohérente (au moins les 2 déjà obtenus, sans doublon).
  const list = await listAchievements((q, p) => pool.query(q, p), userId);
  const codes = list.map(a => a.code);
  assert.equal(new Set(codes).size, codes.length, 'pas de doublon');
  assert.ok(codes.includes('premiere-partie'));
});

test('badge d’Elo : 1700 dans une variante débloque classe-1600', async () => {
  await pool.query(`UPDATE users SET rating_classic = 1700 WHERE id = $1`, [userId]);
  const got = await evaluateAchievements(pool, userId);
  assert.ok(got.includes('classe-1600'));
  assert.ok(!got.includes('expert-1800'), 'pas encore 1800');
});

test('GET /api/users/:id/achievements — public, expose les badges débloqués', async () => {
  const res = await request.get(`/api/users/${userId}/achievements`).set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const codes = res.body.achievements.map(a => a.code);
  assert.ok(codes.includes('premiere-victoire'));
});

test('GET /api/users/:id/achievements — sans token : 401 ; UUID mal formé : 404', async () => {
  assert.equal((await request.get(`/api/users/${userId}/achievements`)).status, 401);
  assert.equal((await request.get('/api/users/pas-un-uuid/achievements').set('Authorization', `Bearer ${token}`)).status, 404);
});
