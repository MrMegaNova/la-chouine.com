'use strict';

// Migration 009 (#279) sur des données antérieures. Le fichier rejoue les
// migrations dans un SCHÉMA dédié : son UPDATE global ne touche donc jamais les
// lignes des autres fichiers de test, qui partagent la même base.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/db');

const SCHEMA = 'test_achievements_backfill';
const MIGRATIONS = path.join(__dirname, '../migrations');
const UNLOCKED_AT = '2026-01-15T10:00:00.000Z';

let client;

async function runMigration(file) {
  await client.query(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
}

async function addUser(name) {
  const { rows } = await client.query(
    `INSERT INTO users (username, email, password_hash, email_verified)
     VALUES ($1, $2, 'x', TRUE) RETURNING id`,
    [name, `${name.toLowerCase()}@backfill.invalid`]);
  return rows[0].id;
}

async function addGame(userId, { mode = 'online', won = false, variant = 'classic', endedAt = '2025-06-03T12:00:00Z' } = {}) {
  const { rows } = await client.query(
    `INSERT INTO games (mode, variant, ended_at) VALUES ($1, $2, $3) RETURNING id`,
    [mode, variant, endedAt]);
  await client.query(
    `INSERT INTO game_players (game_id, user_id, seat, score, won) VALUES ($1, $2, 0, 1, $3)`,
    [rows[0].id, userId, won]);
}

async function grant(userId, ...codes) {
  for (const code of codes) {
    await client.query(
      `INSERT INTO user_achievements (user_id, code, unlocked_at) VALUES ($1, $2, $3)`,
      [userId, code, UNLOCKED_AT]);
  }
}

async function verifiedByCode(userId) {
  const { rows } = await client.query(
    `SELECT code, verified FROM user_achievements WHERE user_id = $1`, [userId]);
  return Object.fromEntries(rows.map(r => [r.code, r.verified]));
}

let localOnly;
let online;
let serverFacts;
let holiday;
let quietDays;
let rowsBefore;

before(async () => {
  client = await pool.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}, public`);

  const files = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
  for (const file of files.filter(f => f < '009')) await runMigration(file);

  // Tout vient de parties locales.
  localOnly = await addUser('BackfillLocal');
  for (let i = 0; i < 10; i++) await addGame(localOnly, { mode: 'ai', won: true });
  await grant(localOnly, 'premiere-partie', 'habitue', 'premiere-victoire', 'gagnant', 'ambidextre');

  // Deux victoires en ligne : justifient les badges de 1er niveau, pas « gagnant ».
  online = await addUser('BackfillOnline');
  await addGame(online, { won: true });
  await addGame(online, { won: true, variant: 'mondoubleau' });
  await addGame(online, { mode: 'ai', won: true });
  await grant(online, 'premiere-partie', 'habitue', 'premiere-victoire', 'gagnant', 'ambidextre');

  // Elo et faits de jeu : établis par le serveur, indépendants des parties.
  serverFacts = await addUser('BackfillFacts');
  await grant(serverFacts, 'classe-1600', 'partie-blanche', 'chouine-faite');

  // Ascension 2025 (29 mai, férié mobile) débutée à 00h30 à Paris, soit le 28 en
  // UTC, puis deux jours consécutifs dont un samedi.
  holiday = await addUser('BackfillHoliday');
  await addGame(holiday, { endedAt: '2025-05-28T22:30:00Z' });
  await addGame(holiday, { endedAt: '2025-05-30T12:00:00Z' });
  await addGame(holiday, { endedAt: '2025-05-31T12:00:00Z' });
  await grant(holiday, 'jour-ferie', 'joueur-weekend', 'assidu');

  // Mardi 3 juin 2025 en ligne ; férié, week-end et série seulement en local.
  quietDays = await addUser('BackfillQuiet');
  await addGame(quietDays);
  await addGame(quietDays, { mode: 'local', endedAt: '2025-07-12T12:00:00Z' });
  await addGame(quietDays, { mode: 'local', endedAt: '2025-07-13T12:00:00Z' });
  await addGame(quietDays, { mode: 'local', endedAt: '2025-07-14T12:00:00Z' });
  await grant(quietDays, 'jour-ferie', 'joueur-weekend', 'assidu');

  rowsBefore = Number((await client.query(`SELECT COUNT(*) AS n FROM user_achievements`)).rows[0].n);
  await runMigration('009_achievements_verified.sql');
});

after(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query('RESET search_path');
  client.release();
  await pool.end();
});

test('aucun badge n’est supprimé et la date d’obtention ne change pas', async () => {
  const { rows } = await client.query(
    `SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE unlocked_at = $1) AS same_date FROM user_achievements`,
    [UNLOCKED_AT]);
  assert.equal(Number(rows[0].n), rowsBefore);
  assert.equal(Number(rows[0].same_date), rowsBefore);
});

test('parties locales uniquement : badges conservés mais non vérifiés', async () => {
  assert.deepEqual(await verifiedByCode(localOnly), {
    'premiere-partie': false,
    habitue: false,
    'premiere-victoire': false,
    gagnant: false,
    ambidextre: false,
  });
});

test('parties en ligne : vérifié seulement si elles suffisent à justifier le badge', async () => {
  assert.deepEqual(await verifiedByCode(online), {
    'premiere-partie': true,
    habitue: false,
    'premiere-victoire': true,
    gagnant: false,
    ambidextre: true,
  });
});

test('Elo et faits de jeu restent vérifiés', async () => {
  assert.deepEqual(await verifiedByCode(serverFacts), {
    'classe-1600': true,
    'partie-blanche': true,
    'chouine-faite': true,
  });
});

test('jours de jeu en ligne : férié mobile, heure de Paris, week-end et série', async () => {
  assert.deepEqual(await verifiedByCode(holiday), {
    'jour-ferie': true,
    'joueur-weekend': true,
    assidu: true,
  });
});

test('jours de jeu uniquement en local : non vérifiés', async () => {
  assert.deepEqual(await verifiedByCode(quietDays), {
    'jour-ferie': false,
    'joueur-weekend': false,
    assidu: false,
  });
});
