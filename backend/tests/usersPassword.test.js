'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { signToken } = require('../src/middleware/auth');
const app = require('../src/app');

const request = supertest(app);
const EMAIL = 'pwdchange@test.la-chouine.invalid';
const OLD = 'Motdepasse123!';

let token;

before(async () => {
  await pool.query(`DELETE FROM users WHERE email = $1`, [EMAIL]);
  const hash = await bcrypt.hash(OLD, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, TRUE) RETURNING id, username`,
    ['PwdChangeUser', EMAIL, hash]
  );
  token = signToken({ id: rows[0].id, username: rows[0].username });
});

after(async () => {
  await pool.query(`DELETE FROM users WHERE email = $1`, [EMAIL]);
  await pool.end();
});

test('POST /api/users/me/password — sans token : refusé', async () => {
  const res = await request.post('/api/users/me/password')
    .send({ currentPassword: OLD, newPassword: 'Nouveau123!' });
  assert.equal(res.status, 401);
});

test('POST /api/users/me/password — mot de passe actuel incorrect : 403', async () => {
  const res = await request.post('/api/users/me/password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: 'MauvaisActuel1!', newPassword: 'Nouveau123!' });
  assert.equal(res.status, 403);
});

test('POST /api/users/me/password — nouveau hors politique : 422', async () => {
  const res = await request.post('/api/users/me/password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: OLD, newPassword: 'faible' });
  assert.equal(res.status, 422);
});

test('POST /api/users/me/password — nouveau identique à l’actuel : 422', async () => {
  const res = await request.post('/api/users/me/password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: OLD, newPassword: OLD });
  assert.equal(res.status, 422);
});

test('POST /api/users/me/password — succès : l’ancien ne marche plus, le nouveau si', async () => {
  const NEW = 'ToutNeuf456?';
  const res = await request.post('/api/users/me/password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: OLD, newPassword: NEW });
  assert.equal(res.status, 200);

  // L'ancien mot de passe est rejeté, le nouveau accepté (compte vérifié).
  const old = await request.post('/api/auth/login').send({ username: 'PwdChangeUser', password: OLD });
  assert.equal(old.status, 401);
  const fresh = await request.post('/api/auth/login').send({ username: 'PwdChangeUser', password: NEW });
  assert.equal(fresh.status, 200);
  assert.ok(fresh.body.token);
});
