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
    password: 'motdepasse123',
  });
  assert.equal(res.status, 422);
  assert.ok(Array.isArray(res.body.errors));
});

test('POST /api/auth/register — email invalide', async () => {
  const res = await request.post('/api/auth/register').send({
    username: 'TestUser1',
    email: 'pas-un-email',
    password: 'motdepasse123',
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

test('POST /api/auth/register — succès', async () => {
  const res = await request.post('/api/auth/register').send({
    username: 'TestUser1',
    email: 'testuser1@test.la-chouine.invalid',
    password: 'motdepasse123',
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.message);
});

test('POST /api/auth/register — pseudo déjà pris', async () => {
  const res = await request.post('/api/auth/register').send({
    username: 'TestUser1',
    email: 'autre@test.la-chouine.invalid',
    password: 'motdepasse123',
  });
  assert.equal(res.status, 409);
});

test('POST /api/auth/login — compte non vérifié', async () => {
  const res = await request.post('/api/auth/login').send({
    username: 'TestUser1',
    password: 'motdepasse123',
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
