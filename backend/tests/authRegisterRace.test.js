'use strict';

// Course à l'inscription (#224) : entre le SELECT d'unicité et l'INSERT, une
// requête concurrente peut créer le même compte. La contrainte DB est la vraie
// garde : le doublon doit répondre 409, sans décompter d'inscription (#86).

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { pool } = require('../src/db');
const { logger } = require('../src/logger');
const { authGuard } = require('../src/services/authGuard');
const emailService = require('../src/services/email');

const DOMAIN = '@authregrace.invalid';
const PASSWORD = 'Motdepasse123!';
const CONFLICT_MESSAGE = 'Ce pseudo ou cette adresse email est déjà utilisé.';

// La route lit ces deux dépendances à son chargement : on remplace l'envoi
// d'email, et on active les garde-fous (débrayés en test) sans quoi
// `registerRecorded` ne serait jamais appelé et son assertion ne prouverait rien.
let mailsSent = 0;
emailService.sendVerificationEmail = async () => { mailsSent += 1; };
config.isTest = false;
const authRoutes = require('../src/routes/auth');
config.isTest = true;

// Application réduite au routeur : `app.js` activerait ses rate limiters
// indépendamment de ce qui est testé ici.
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.log = logger; next(); });
app.use('/api/auth', authRoutes);
const request = supertest(app);

async function cleanup() {
  await pool.query(`DELETE FROM users WHERE email ILIKE $1`, [`%${DOMAIN}`]);
}

before(cleanup);
beforeEach(() => { mailsSent = 0; });

after(async () => {
  await cleanup();
  await pool.end();
});

function register(username, email) {
  return request.post('/api/auth/register').send({ username, email, password: PASSWORD });
}

// Reproduit la course de façon déterministe, sans simuler la base : le rival est
// inséré pendant le hash du mot de passe, soit après le SELECT et avant l'INSERT.
// L'INSERT lève donc une vraie erreur 23505 de Postgres.
function insertRivalDuringHash(t, username, email) {
  const realHash = bcrypt.hash;
  return t.mock.method(bcrypt, 'hash', async (...args) => {
    await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x')`,
      [username, email]
    );
    return realHash(...args);
  });
}

test('témoin : une inscription réussie est décomptée et envoie un email', async (t) => {
  const recorded = t.mock.method(authGuard, 'registerRecorded');

  const res = await register('RaceTemoin', `temoin${DOMAIN}`);

  assert.equal(res.status, 201);
  assert.equal(recorded.mock.callCount(), 1);
  assert.equal(mailsSent, 1);
});

test('course sur le pseudo : 409, sans décompte ni email', async (t) => {
  const hash = insertRivalDuringHash(t, 'RacePseudo', `rival-pseudo${DOMAIN}`);
  const recorded = t.mock.method(authGuard, 'registerRecorded');

  const res = await register('RacePseudo', `perdant-pseudo${DOMAIN}`);

  assert.equal(hash.mock.callCount(), 1, 'le SELECT préalable doit avoir laissé passer');
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { errors: [CONFLICT_MESSAGE] });
  assert.equal(recorded.mock.callCount(), 0);
  assert.equal(mailsSent, 0);
});

test('course sur l\'email (insensible à la casse) : 409, sans décompte ni email', async (t) => {
  const hash = insertRivalDuringHash(t, 'RaceRivalEmail', `Course-Email${DOMAIN}`);
  const recorded = t.mock.method(authGuard, 'registerRecorded');

  const res = await register('RacePerdantEmail', `course-email${DOMAIN}`);

  assert.equal(hash.mock.callCount(), 1, 'le SELECT préalable doit avoir laissé passer');
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { errors: [CONFLICT_MESSAGE] });
  assert.equal(recorded.mock.callCount(), 0);
  assert.equal(mailsSent, 0);
});

test('deux inscriptions simultanées : une 201, une 409, un seul compte', async (t) => {
  // Barrière : sans elle, le hash de la première requête monopolise la boucle
  // d'événements et la seconde voit son compte au SELECT, sans aucune course.
  // Ici, chacune attend que l'autre ait passé le SELECT avant de poursuivre.
  const realHash = bcrypt.hash;
  let arrived = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  const hash = t.mock.method(bcrypt, 'hash', async (...args) => {
    arrived += 1;
    if (arrived === 2) releaseBarrier();
    await barrier;
    return realHash(...args);
  });
  const recorded = t.mock.method(authGuard, 'registerRecorded');

  const responses = await Promise.all([
    register('RaceSimultane', `simultane${DOMAIN}`),
    register('RaceSimultane', `simultane${DOMAIN}`),
  ]);

  assert.equal(hash.mock.callCount(), 2, 'les deux requêtes doivent avoir passé le SELECT');
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  assert.equal(recorded.mock.callCount(), 1);
  assert.equal(mailsSent, 1);
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE username = 'RaceSimultane'`);
  assert.equal(rows.length, 1);
});

test('une autre erreur reste un 500 : seul le code 23505 devient un 409', async (t) => {
  t.mock.method(bcrypt, 'hash', async () => {
    throw Object.assign(new Error('panne simulée'), { code: '23503' });
  });

  const res = await register('RacePanne', `panne${DOMAIN}`);

  assert.equal(res.status, 500);
});
