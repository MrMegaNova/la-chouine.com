'use strict';

// File de matchmaking Redis (#31) : mêmes garanties que la file en mémoire
// (Matchmaker), mais sur un stockage partageable entre instances. La logique
// d'appariement étant la fonction pure `pairTickets`, on vérifie surtout le
// stockage (join/leave/unicité, désérialisation des nombres) et que la fenêtre
// d'Elo élargie par l'attente s'applique bien via le store.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'x';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'x';
process.env.PGDATABASE = process.env.PGDATABASE || 'x';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://mock';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { useMockRedis, flush } = require('./helpers/redis');
const store = require('../src/realtime/matchmakingStore');

let redis;
beforeEach(async () => { redis = useMockRedis(); await flush(redis); });

test('join/leave : un seul ticket par joueur, compté par variante', async () => {
  await store.join({ userId: 'u1', name: 'A', rating: 1500, variant: 'classic' });
  await store.join({ userId: 'u2', name: 'B', rating: 1520, variant: 'classic' });
  await store.join({ userId: 'u3', name: 'C', rating: 1500, variant: 'mondoubleau' });

  assert.equal(await store.size('classic'), 2);
  assert.equal(await store.size('mondoubleau'), 1);
  assert.equal(await store.totalSize(), 3);
  assert.equal(await store.has('u1'), true);

  // Re-join dans une autre variante : déplace, ne duplique pas.
  await store.join({ userId: 'u1', name: 'A', rating: 1500, variant: 'mondoubleau' });
  assert.equal(await store.size('classic'), 1);
  assert.equal(await store.size('mondoubleau'), 2);
  assert.equal(await store.totalSize(), 3);

  assert.equal(await store.leave('u1'), true);
  assert.equal(await store.has('u1'), false);
  assert.equal(await store.leave('u1'), false); // déjà parti
});

test('listTickets : nombres désérialisés', async () => {
  await store.join({ userId: 'u1', name: 'A', rating: 1500, variant: 'classic' }, 1000);
  const [t] = await store.listTickets('classic');
  assert.equal(t.rating, 1500);
  assert.equal(typeof t.rating, 'number');
  assert.equal(t.joinedAt, 1000);
  assert.equal(typeof t.joinedAt, 'number');
});

test('findMatches : apparie deux joueurs proches et les retire de la file', async () => {
  await store.join({ userId: 'u1', name: 'A', rating: 1500, variant: 'classic' }, 0);
  await store.join({ userId: 'u2', name: 'B', rating: 1510, variant: 'classic' }, 0);

  const pairs = await store.findMatches(store.DEFAULT_PARAMS, 0);
  assert.equal(pairs.length, 1);
  const ids = pairs[0].map(t => t.userId).sort();
  assert.deepEqual(ids, ['u1', 'u2']);
  assert.equal(await store.totalSize(), 0); // retirés
});

test('findMatches : écart trop grand non apparié, sauf après élargissement de la fenêtre', async () => {
  await store.join({ userId: 'u1', name: 'A', rating: 1000, variant: 'classic' }, 0);
  await store.join({ userId: 'u2', name: 'B', rating: 1400, variant: 'classic' }, 0);

  // À t=0, écart 400 > fenêtre initiale 50 → pas d'appariement.
  assert.equal((await store.findMatches(store.DEFAULT_PARAMS, 0)).length, 0);
  assert.equal(await store.totalSize(), 2);

  // Au-delà de fallbackMs, fenêtre infinie → appariés.
  const pairs = await store.findMatches(store.DEFAULT_PARAMS, store.DEFAULT_PARAMS.fallbackMs + 1);
  assert.equal(pairs.length, 1);
  assert.equal(await store.totalSize(), 0);
});

test('findMatches : variantes cloisonnées (jamais d’appariement inter-variante)', async () => {
  await store.join({ userId: 'u1', name: 'A', rating: 1500, variant: 'classic' }, 0);
  await store.join({ userId: 'u2', name: 'B', rating: 1500, variant: 'mondoubleau' }, 0);
  assert.equal((await store.findMatches(store.DEFAULT_PARAMS, store.DEFAULT_PARAMS.fallbackMs + 1)).length, 0);
});
