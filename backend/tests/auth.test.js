'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { pool } = require('../src/db');
const app = require('../src/app');

const request = supertest(app);

before(async () => {
  await pool.query(
    `DELETE FROM users WHERE email ILIKE '%@test.la-chouine.invalid'`
  );
});

after(async () => {
  await pool.query(
    `DELETE FROM users WHERE email ILIKE '%@test.la-chouine.invalid'`
  );
  await pool.end();
});

test('GET /api/health retourne ok', async () => {
  const res = await request.get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('POST /api/auth/register — pseudo invalide', async () => {
  const res = await request.post('/api/auth/register').send({
    username: 'a', // trop court
    email: 'user@test.la-chouine.invalid',
    password: 'Motdepasse123!',
  });
  assert.equal(res.status, 422);
  assert.ok(Array.isArray(res.body.errors));
});

test('POST /api/auth/register — email invalide', async () => {
  const res = await request.post('/api/auth/register').send({
    username: 'TestUser1',
    email: 'pas-un-email',
    password: 'Motdepasse123!',
  });
  assert.equal(res.status, 422);
});

test('POST /api/auth/register — mot de passe trop court', async () => {
  const res = await request.post('/api/auth/register').send({
    username: 'TestUser1',
    email: 'user@test.la-chouine.invalid',
    password: '1234567', // 7 chars
  });
  assert.equal(res.status, 422);
});

test('POST /api/auth/register — politique mot de passe', async () => {
  const cases = ['motdepasse123', 'MOTDEPASSE123', 'MotDePasse', 'MotDePasse123'];
  for (const password of cases) {
    const res = await request.post('/api/auth/register').send({
      username: 'TestUser1',
      email: 'user@test.la-chouine.invalid',
      password,
    });
    assert.equal(res.status, 422, `password "${password}" aurait dû être rejeté`);
  }
});

test('POST /api/auth/register — succès', async () => {
  const res = await request.post('/api/auth/register').send({
    username: 'TestUser1',
    email: 'testuser1@test.la-chouine.invalid',
    password: 'Motdepasse123!',
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.message);
});

test('POST /api/auth/register — pseudo déjà pris', async () => {
  const res = await request.post('/api/auth/register').send({
    username: 'TestUser1',
    email: 'autre@test.la-chouine.invalid',
    password: 'Motdepasse123!',
  });
  assert.equal(res.status, 409);
});

test('POST /api/auth/login — compte non vérifié', async () => {
  const res = await request.post('/api/auth/login').send({
    username: 'TestUser1',
    password: 'Motdepasse123!',
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'EMAIL_NOT_VERIFIED');
});

test('POST /api/auth/login — identifiants incorrects', async () => {
  const res = await request.post('/api/auth/login').send({
    username: 'InexistantXYZ',
    password: 'nimportequoi',
  });
  assert.equal(res.status, 401);
});

test('GET /api/auth/verify-email — token invalide', async () => {
  const res = await request.get('/api/auth/verify-email?token=' + 'a'.repeat(64));
  assert.equal(res.status, 400);
});

test('GET /api/users/me — sans token', async () => {
  const res = await request.get('/api/users/me');
  assert.equal(res.status, 401);
});

test('POST /api/auth/forgot-password — réponse générique', async () => {
  const res = await request.post('/api/auth/forgot-password').send({
    email: 'inexistant@test.la-chouine.invalid',
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.message);
});

test('POST /api/auth/forgot-password — compte non activé : renvoie un lien d’activation (#105)', async () => {
  // TestUser1 (créé plus haut) n'est pas activé : le formulaire doit
  // régénérer un verify_token, pas un reset_token.
  const before = await pool.query(
    `SELECT verify_token, reset_token FROM users WHERE email = $1`,
    ['testuser1@test.la-chouine.invalid']
  );
  const res = await request.post('/api/auth/forgot-password').send({
    email: 'testuser1@test.la-chouine.invalid',
  });
  assert.equal(res.status, 200);

  const after = await pool.query(
    `SELECT verify_token, verify_expires, reset_token, email_verified
     FROM users WHERE email = $1`,
    ['testuser1@test.la-chouine.invalid']
  );
  assert.equal(after.rows[0].email_verified, false);
  assert.notEqual(after.rows[0].verify_token, before.rows[0].verify_token, 'nouveau lien d’activation émis');
  assert.ok(after.rows[0].verify_token, 'verify_token présent');
  assert.ok(after.rows[0].verify_expires, 'expiration repoussée');
  assert.equal(after.rows[0].reset_token, null, 'aucun token de reset émis pour un compte non activé');
});
