'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { signToken } = require('../src/middleware/auth');
const app = require('../src/app');

const request = supertest(app);
// Domaine dédié à ce fichier : les tests tournent en parallèle sur la même
// base, ne jamais matcher le motif de purge d'un autre fichier.
const DOMAIN = '@gamesroute.invalid';

let alice;     // { id, token }
let bobId;     // victime potentielle (#116) — un autre vrai utilisateur

before(async () => {
  await pool.query(`DELETE FROM users WHERE email LIKE '%' || $1`, [DOMAIN]);
  const hash = await bcrypt.hash('Motdepasse123!', 12);
  const ins = async (name) => (await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, TRUE) RETURNING id, username, rating_classic`,
    [name, `${name.toLowerCase()}${DOMAIN}`, hash]
  )).rows[0];
  const a = await ins('GamesAlice');
  const b = await ins('GamesBob');
  alice = { id: a.id, token: signToken({ id: a.id, username: a.username }) };
  bobId = b.id;
});

after(async () => {
  await pool.query(`DELETE FROM users WHERE email LIKE '%' || $1`, [DOMAIN]);
  await pool.end();
});

const basePayload = (over = {}) => ({
  mode: 'ai',
  variant: 'classic',
  playerCount: 2,
  targetScore: 3,
  players: [
    { userId: null, guestName: null, score: 3, won: true },
    { userId: null, guestName: 'Ordinateur', score: 1, won: false },
  ],
  ...over,
});

test('POST /api/games — mode online refusé (#116) : l’Elo ne se déclare pas côté client', async () => {
  const res = await request.post('/api/games')
    .set('Authorization', `Bearer ${alice.token}`)
    .send(basePayload({
      mode: 'online',
      players: [
        { userId: alice.id, guestName: null, score: 3, won: true },
        { userId: bobId, guestName: null, score: 0, won: false },
      ],
    }));
  assert.equal(res.status, 422);

  // L'Elo de Bob n'a pas bougé.
  const { rows } = await pool.query(`SELECT rating_classic FROM users WHERE id = $1`, [bobId]);
  assert.equal(Number(rows[0].rating_classic), 1500);
});

test('POST /api/games — un tiers référencé est rétrogradé en invité (#116)', async () => {
  const res = await request.post('/api/games')
    .set('Authorization', `Bearer ${alice.token}`)
    .send(basePayload({
      players: [
        { userId: alice.id, guestName: null, score: 3, won: true },
        { userId: bobId, guestName: null, score: 1, won: false }, // usurpation tentée
      ],
    }));
  assert.equal(res.status, 201);

  const { rows } = await pool.query(
    `SELECT user_id, guest_name, won FROM game_players WHERE game_id = $1 ORDER BY seat`,
    [res.body.id]
  );
  assert.equal(rows[0].user_id, alice.id, 'l’appelant est rattaché');
  assert.equal(rows[1].user_id, null, 'le tiers n’est PAS rattaché');
  assert.ok(rows[1].guest_name, 'le siège du tiers devient un invité');
});

test('POST /api/games — partie IA légitime enregistrée', async () => {
  const res = await request.post('/api/games')
    .set('Authorization', `Bearer ${alice.token}`)
    .send(basePayload({
      players: [
        { userId: alice.id, guestName: null, score: 3, won: true },
        { userId: null, guestName: 'Ordinateur', score: 0, won: false },
      ],
    }));
  assert.equal(res.status, 201);
  assert.ok(res.body.id);
});
