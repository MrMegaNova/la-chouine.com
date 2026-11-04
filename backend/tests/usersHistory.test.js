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
const DOMAIN = '@usershistory.invalid';

let alice; // { id, token }
let bobId; // vrai compte, adversaire PvP

// Supprime les parties des utilisateurs de test PUIS les utilisateurs.
async function cleanup() {
  await pool.query(
    `DELETE FROM games WHERE id IN (
       SELECT gp.game_id FROM game_players gp
       JOIN users u ON u.id = gp.user_id
       WHERE u.email LIKE '%' || $1
     )`,
    [DOMAIN]
  );
  await pool.query(`DELETE FROM users WHERE email LIKE '%' || $1`, [DOMAIN]);
}

// Crée une partie terminée ; chaque siège est { userId } ou { guestName }.
async function insertGame(mode, seats) {
  const { rows } = await pool.query(
    `INSERT INTO games (mode, variant, player_count, target_score, ended_at)
     VALUES ($1, 'classic', $2, 3, NOW()) RETURNING id`,
    [mode, seats.length]
  );
  for (const [seat, s] of seats.entries()) {
    await pool.query(
      `INSERT INTO game_players (game_id, user_id, guest_name, seat, score, won)
       VALUES ($1, $2, $3, $4, 0, FALSE)`,
      [rows[0].id, s.userId ?? null, s.guestName ?? null, seat]
    );
  }
  return rows[0].id;
}

async function historyEntry(gameId) {
  const res = await request.get('/api/users/history')
    .set('Authorization', `Bearer ${alice.token}`);
  assert.equal(res.status, 200);
  const entry = res.body.find(g => g.id === gameId);
  assert.ok(entry, 'la partie figure dans l’historique');
  return entry;
}

before(async () => {
  await cleanup();
  const hash = await bcrypt.hash('Motdepasse123!', 12);
  const ins = async (name) => (await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, TRUE) RETURNING id, username`,
    [name, `${name.toLowerCase()}${DOMAIN}`, hash]
  )).rows[0];
  const a = await ins('HistAlice');
  const b = await ins('HistBob');
  alice = { id: a.id, token: signToken({ id: a.id, username: a.username }) };
  bobId = b.id;
});

after(async () => {
  await cleanup();
  await pool.end();
});

test('GET /api/users/history — partie IA enregistrée : l’invité apparaît comme adversaire (#226)', async () => {
  const created = await request.post('/api/games')
    .set('Authorization', `Bearer ${alice.token}`)
    .send({
      mode: 'ai',
      variant: 'classic',
      playerCount: 2,
      targetScore: 3,
      players: [
        { userId: alice.id, score: 3, won: true },
        { userId: null, guestName: 'Ordinateur', score: 1, won: false },
      ],
    });
  assert.equal(created.status, 201);

  const entry = await historyEntry(created.body.id);
  assert.equal(entry.opponents, 'Ordinateur');
});

test('GET /api/users/history — PvP : l’adversaire est le vrai compte, sans le joueur lui-même', async () => {
  const gameId = await insertGame('online', [{ userId: alice.id }, { userId: bobId }]);
  const entry = await historyEntry(gameId);
  assert.equal(entry.opponents, 'HistBob');
});

test('GET /api/users/history — sièges mixtes : comptes et invités dans l’ordre des sièges', async () => {
  const gameId = await insertGame('online', [
    { guestName: 'Mamie' },
    { userId: alice.id },
    { userId: bobId },
    { guestName: 'Tonton' },
  ]);
  const entry = await historyEntry(gameId);
  assert.equal(entry.opponents, 'Mamie, HistBob, Tonton');
});
