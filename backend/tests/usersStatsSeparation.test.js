'use strict';

// Séparation des résultats établis par le serveur et des résultats déclarés
// (#279) : tout ce qui se compare entre joueurs repose sur les parties en ligne.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { signToken } = require('../src/middleware/auth');
const { useMockRedis, flush, closeRedis } = require('./helpers/redis');
const app = require('../src/app');

const request = supertest(app);
// Domaine email dédié au fichier (isolation des tests parallèles, cf. CLAUDE.md).
const DOMAIN = '@usersstats.invalid';

let viewer; // { id, token } : ami de la cible
let target; // { id, token } : 1 victoire en ligne et 1 défaite, 3 parties locales

const auth = (req, who = viewer) => req.set('Authorization', `Bearer ${who.token}`);

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

async function addGame(mode, userId, won) {
  const { rows } = await pool.query(
    `INSERT INTO games (mode, ended_at) VALUES ($1, NOW()) RETURNING id`, [mode]);
  await pool.query(
    `INSERT INTO game_players (game_id, user_id, seat, score, won) VALUES ($1, $2, 0, 1, $3)`,
    [rows[0].id, userId, won]);
  return rows[0].id;
}

before(async () => {
  await cleanup();
  const hash = await bcrypt.hash('Motdepasse123!', 12);
  const ins = async (name) => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (username, email, password_hash, email_verified)
       VALUES ($1, $2, $3, TRUE) RETURNING id, username`,
      [name, `${name.toLowerCase()}${DOMAIN}`, hash]);
    return { id: u.id, token: signToken({ id: u.id, username: u.username }) };
  };
  viewer = await ins('StatsViewer');
  target = await ins('StatsTarget');
  await pool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')`,
    [viewer.id, target.id]);

  await addGame('online', target.id, true);
  await addGame('online', target.id, false);
  await addGame('ai', target.id, true);
  await addGame('local', target.id, true);
  await addGame('friend', target.id, false);

  // Ancienne partie locale où le joueur occupe deux sièges : les lignes restent
  // en base, mais elle ne compte que pour UNE partie.
  const legacy = await addGame('ai', target.id, true);
  await pool.query(
    `INSERT INTO game_players (game_id, user_id, seat, score, won) VALUES ($1, $2, 1, 1, TRUE)`,
    [legacy, target.id]);

  await pool.query(
    `INSERT INTO user_achievements (user_id, code, verified)
     VALUES ($1, 'chouine-faite', TRUE), ($1, 'gagnant', FALSE)`,
    [target.id]);
});

beforeEach(async () => { const r = useMockRedis(15); await flush(r); });

after(async () => {
  await cleanup();
  await closeRedis();
  await pool.end();
});

const EXPECTED_STATS = {
  wins: 1, losses: 1, plays: 2,
  local: { wins: 3, losses: 1, plays: 4 },
};

test('GET /api/users/me : les statistiques séparent le serveur du déclaré', async () => {
  const res = await auth(request.get('/api/users/me'), target);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.stats, EXPECTED_STATS);
});

test('GET /api/users/me : le titulaire garde ses badges non vérifiés, signalés', async () => {
  const res = await auth(request.get('/api/users/me'), target);
  const byCode = new Map(res.body.achievements.map(a => [a.code, a.verified]));
  assert.equal(byCode.get('chouine-faite'), true);
  assert.equal(byCode.get('gagnant'), false);
});

test('GET /api/users/:id : mêmes statistiques, séparées et publiques', async () => {
  const res = await auth(request.get(`/api/users/${target.id}`));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.stats, EXPECTED_STATS);
});

test('profil public : aucun badge reposant sur du déclaré', async () => {
  const profile = await auth(request.get(`/api/users/${target.id}`));
  assert.deepEqual(profile.body.achievements.map(a => a.code), ['chouine-faite']);

  const list = await auth(request.get(`/api/users/${target.id}/achievements`));
  assert.deepEqual(list.body.achievements.map(a => a.code), ['chouine-faite']);
});

test('GET /api/users/search : seules les parties en ligne sont comparées', async () => {
  const res = await auth(request.get('/api/users/search?q=StatsTarget'));
  assert.equal(res.status, 200);
  assert.equal(res.body[0].wins, 1);
  assert.equal(res.body[0].plays, 2);
});

test('GET /api/friends : seules les parties en ligne sont comparées', async () => {
  const res = await auth(request.get('/api/friends'));
  assert.equal(res.status, 200);
  const friend = res.body.find(f => f.id === target.id);
  assert.equal(friend.wins, 1);
  assert.equal(friend.plays, 2);
});

test('POST /api/games : une partie locale reste visible sans changer les résultats comparés', async () => {
  const save = await auth(request.post('/api/games'), target).send({
    mode: 'ai',
    variant: 'classic',
    playerCount: 2,
    targetScore: 3,
    players: [
      { userId: target.id, guestName: null, score: 3, won: true },
      { userId: null, guestName: 'Ordinateur', score: 0, won: false },
    ],
  });
  assert.equal(save.status, 201);

  const { body } = await auth(request.get('/api/users/me'), target);
  assert.equal(body.stats.wins, 1);
  assert.equal(body.stats.plays, 2);
  assert.equal(body.stats.local.wins, 4);
  assert.equal(body.stats.local.plays, 5);

  const history = await auth(request.get('/api/users/history'), target);
  assert.ok(history.body.some(g => g.id === save.body.id), 'la partie figure dans l’historique');
});
