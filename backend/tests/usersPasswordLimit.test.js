'use strict';

// Limite des essais sur POST /api/users/me/password (#293). Le limiteur est
// désactivé en NODE_ENV=test : ce test le réactive le temps de ses requêtes. Le
// compteur vit en mémoire du process, propre à ce fichier.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { signToken } = require('../src/middleware/auth');
const app = require('../src/app');

const request = supertest(app);
const EMAIL = 'limit@userspwlimit.invalid';
const PWD_A = 'Motdepasse123!';
const PWD_B = 'ToutNeuf456?';
const LIMIT = 10;
const previousEnv = process.env.NODE_ENV;

let userId;
let token;

const attempt = (currentPassword, newPassword) => request.post('/api/users/me/password')
  .set('Authorization', `Bearer ${token}`)
  .send({ currentPassword, newPassword });

// Un changement réussi révoque le JWT courant (#117) : on suit le token réémis.
async function changePassword(currentPassword, newPassword) {
  const res = await attempt(currentPassword, newPassword);
  assert.equal(res.status, 200);
  token = res.body.token;
}

before(async () => {
  await pool.query(`DELETE FROM users WHERE email = $1`, [EMAIL]);
  const hash = await bcrypt.hash(PWD_A, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, $3, TRUE) RETURNING id, username`,
    ['PwdLimitUser', EMAIL, hash]
  );
  userId = rows[0].id;
  token = signToken({ id: rows[0].id, username: rows[0].username });
  process.env.NODE_ENV = 'limiter-actif';
});

after(async () => {
  process.env.NODE_ENV = previousEnv;
  await pool.query(`DELETE FROM users WHERE email = $1`, [EMAIL]);
  await pool.end();
});

test('POST /api/users/me/password — seuls les échecs comptent, puis 429', async () => {
  for (let i = 0; i < LIMIT - 1; i++) {
    const res = await attempt('MauvaisActuel1!', 'Nouveau123!');
    assert.equal(res.status, 403, `échec n° ${i + 1}`);
  }

  // Les succès ne consomment pas le quota : comptés, le second serait refusé.
  await changePassword(PWD_A, PWD_B);
  await changePassword(PWD_B, PWD_A);

  const last = await attempt('MauvaisActuel1!', 'Nouveau123!');
  assert.equal(last.status, 403, 'le dernier échec autorisé est encore traité');

  // Quota atteint : même le bon mot de passe est refusé, sans effet en base.
  const blocked = await attempt(PWD_A, PWD_B);
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Trop de tentatives/);
  const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  assert.equal(await bcrypt.compare(PWD_A, rows[0].password_hash), true);
});
