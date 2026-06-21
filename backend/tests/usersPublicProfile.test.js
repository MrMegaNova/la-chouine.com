'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { signToken } = require('../src/middleware/auth');
const app = require('../src/app');

const request = supertest(app);
// Domaine email dédié au fichier (isolation des tests parallèles, cf. CLAUDE.md).
const DOMAIN = 'publicprofile.invalid';
let viewerToken;     // utilisateur connecté qui consulte
let targetId;        // joueur dont on lit le profil public
let unverifiedId;    // compte non vérifié → introuvable publiquement

before(async () => {
  await pool.query(`DELETE FROM game_players WHERE user_id IN (SELECT id FROM users WHERE email ILIKE $1)`, [`%@${DOMAIN}`]);
  await pool.query(`DELETE FROM users WHERE email ILIKE $1`, [`%@${DOMAIN}`]);
  const hash = await bcrypt.hash('Motdepasse123!', 12);

  const viewer = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, TRUE) RETURNING id, username`,
    ['ViewerPub', `viewer@${DOMAIN}`, hash]);
  viewerToken = signToken({ id: viewer.rows[0].id, username: viewer.rows[0].username });

  const target = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified, rating_classic, rating_mondoubleau)
     VALUES ($1, $2, $3, TRUE, 1620, 1480) RETURNING id`,
    ['TargetPub', `target@${DOMAIN}`, hash]);
  targetId = target.rows[0].id;

  const unverified = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, FALSE) RETURNING id`,
    ['UnverifPub', `unverif@${DOMAIN}`, hash]);
  unverifiedId = unverified.rows[0].id;

  // Une partie gagnée + une perdue pour la cible → stats non triviales.
  const g = await pool.query(
    `INSERT INTO games (mode, variant) VALUES ('online', 'classic') RETURNING id`);
  await pool.query(
    `INSERT INTO game_players (game_id, user_id, seat, score, won)
     VALUES ($1, $2, 0, 3, TRUE)`, [g.rows[0].id, targetId]);
  const g2 = await pool.query(
    `INSERT INTO games (mode, variant) VALUES ('online', 'classic') RETURNING id`);
  await pool.query(
    `INSERT INTO game_players (game_id, user_id, seat, score, won)
     VALUES ($1, $2, 1, 1, FALSE)`, [g2.rows[0].id, targetId]);
});

after(async () => {
  // Supprimer les games d'abord : la FK game_players → games est ON DELETE
  // CASCADE, donc les sièges partent avec (et on évite des games orphelins).
  await pool.query(`DELETE FROM games WHERE id IN (
    SELECT game_id FROM game_players WHERE user_id IN (SELECT id FROM users WHERE email ILIKE $1)
  )`, [`%@${DOMAIN}`]);
  await pool.query(`DELETE FROM users WHERE email ILIKE $1`, [`%@${DOMAIN}`]);
  await pool.end();
});

test('GET /api/users/:id — sans token : 401', async () => {
  const res = await request.get(`/api/users/${targetId}`);
  assert.equal(res.status, 401);
});

test('GET /api/users/:id — profil public : Elo, stats, ratio ; pas d’email', async () => {
  const res = await request.get(`/api/users/${targetId}`).set('Authorization', `Bearer ${viewerToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.username, 'TargetPub');
  assert.equal(res.body.ratings.classic, 1620);
  assert.equal(res.body.ratings.mondoubleau, 1480);
  assert.equal(res.body.stats.plays, 2);
  assert.equal(res.body.stats.wins, 1);
  assert.equal(res.body.stats.losses, 1);
  assert.equal(res.body.email, undefined, 'aucune donnée privée (email) exposée');
});

test('GET /api/users/:id — UUID mal formé : 404 (pas de 500)', async () => {
  const res = await request.get('/api/users/pas-un-uuid').set('Authorization', `Bearer ${viewerToken}`);
  assert.equal(res.status, 404);
});

test('GET /api/users/:id — UUID inexistant : 404', async () => {
  const res = await request.get('/api/users/00000000-0000-0000-0000-000000000000')
    .set('Authorization', `Bearer ${viewerToken}`);
  assert.equal(res.status, 404);
});

test('GET /api/users/:id — compte non vérifié : 404 (non listable publiquement)', async () => {
  const res = await request.get(`/api/users/${unverifiedId}`).set('Authorization', `Bearer ${viewerToken}`);
  assert.equal(res.status, 404);
});
