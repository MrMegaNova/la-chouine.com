'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { signToken } = require('../src/middleware/auth');
const app = require('../src/app');

const request = supertest(app);
const EMAIL = 'avataruser@avatartest.invalid';
let token;

before(async () => {
  await pool.query(`DELETE FROM users WHERE email = $1`, [EMAIL]);
  const hash = await bcrypt.hash('Motdepasse123!', 12);
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, TRUE) RETURNING id, username`,
    ['AvatarUser', EMAIL, hash]
  );
  token = signToken({ id: rows[0].id, username: rows[0].username });
});

after(async () => {
  await pool.query(`DELETE FROM users WHERE email = $1`, [EMAIL]);
  await pool.end();
});

const VALID = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('POST /api/users/me/avatar — sans token : 401', async () => {
  const res = await request.post('/api/users/me/avatar').send({ avatar: VALID });
  assert.equal(res.status, 401);
});

test('POST /api/users/me/avatar — format invalide : 422', async () => {
  for (const bad of ['pas une image', 'data:text/html;base64,AAAA', 'data:image/gif;base64,AAAA', 123]) {
    const res = await request.post('/api/users/me/avatar')
      .set('Authorization', `Bearer ${token}`).send({ avatar: bad });
    assert.equal(res.status, 422, `attendu 422 pour ${bad}`);
  }
});

test('POST /api/users/me/avatar — image trop lourde : 413', async () => {
  const huge = 'data:image/png;base64,' + 'A'.repeat(61_000);
  const res = await request.post('/api/users/me/avatar')
    .set('Authorization', `Bearer ${token}`).send({ avatar: huge });
  assert.equal(res.status, 413);
});

test('POST puis DELETE /api/users/me/avatar — cycle complet, reflété dans /me', async () => {
  const set = await request.post('/api/users/me/avatar')
    .set('Authorization', `Bearer ${token}`).send({ avatar: VALID });
  assert.equal(set.status, 200);
  assert.equal(set.body.avatar, VALID);

  const me = await request.get('/api/users/me').set('Authorization', `Bearer ${token}`);
  assert.equal(me.body.avatar, VALID, 'l’avatar est renvoyé par /me');

  const del = await request.delete('/api/users/me/avatar').set('Authorization', `Bearer ${token}`);
  assert.equal(del.status, 200);

  const me2 = await request.get('/api/users/me').set('Authorization', `Bearer ${token}`);
  assert.equal(me2.body.avatar, null, 'l’avatar est retiré');
});
