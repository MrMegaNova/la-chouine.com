'use strict';

// Persistance Redis des sessions (#31) : création/lecture/suppression, index par
// joueur, compteur de présence, propriété d'instance, et verrou de mutation
// (sérialisation des coups concurrents entre instances).

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'x';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'x';
process.env.PGDATABASE = process.env.PGDATABASE || 'x';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://mock';

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { useMockRedis, flush, closeRedis } = require('./helpers/redis');
const store = require('../src/realtime/sessionStore');

const PLAYERS = [{ userId: 'u1', name: 'Alice' }, { userId: 'u2', name: 'Bob' }];

let redis;
beforeEach(async () => { redis = useMockRedis(3); await flush(redis); }); // db 3 : isolation fichier
after(closeRedis);

test('create/get : persiste et recharge une session jouable', async () => {
  const created = await store.createSession({ players: PLAYERS, variant: 'classic', rated: true });
  const loaded = await store.getSession(created.id);
  assert.ok(loaded, 'session rechargée');
  assert.deepEqual(loaded.snapshotFor('u1'), created.snapshotFor('u1'));
  // Index par joueur + compteur de présence.
  assert.equal(await store.sessionIdForUser('u1'), created.id);
  assert.equal(await store.activeUserCount(), 2);
});

test('save : un coup appliqué est bien persisté', async () => {
  const s = await store.createSession({ players: PLAYERS, rated: true });
  // Coupe interactive (#201) : les deux sièges piochent (→ révélation), puis on
  // clôt la révélation pour distribuer la 1ʳᵉ main.
  s.applyAction('u1', { type: 'cut' });
  s.applyAction('u2', { type: 'cut' });
  s.finishReveal();
  const seat = s.state.turn;
  const snap = s.snapshotFor(s.players[seat].userId);
  assert.ok(s.applyAction(s.players[seat].userId, { type: 'play', card: snap.players[seat].legalMoves[0] }).ok);
  await store.save(s);

  const loaded = await store.getSession(s.id);
  assert.deepEqual(loaded.snapshotFor('u1'), s.snapshotFor('u1'));
  assert.notEqual(loaded.state.turn, undefined);
});

test('owner : la session note son instance propriétaire', async () => {
  const s = await store.createSession({ players: PLAYERS, owner: 'inst-A' });
  assert.equal(await store.ownerOf(s.id), 'inst-A');
});

test('endSession : supprime état, index et présence', async () => {
  const s = await store.createSession({ players: PLAYERS });
  await store.endSession(s.id);
  assert.equal(await store.getSession(s.id), null);
  assert.equal(await store.sessionForUser('u1'), null);
  assert.equal(await store.activeUserCount(), 0);
});

test('withLock : exclusion mutuelle (les sections critiques ne se chevauchent pas)', async () => {
  const s = await store.createSession({ players: PLAYERS });
  let active = 0; let maxConcurrent = 0;
  const critical = () => store.withLock(s.id, async () => {
    active += 1; maxConcurrent = Math.max(maxConcurrent, active);
    await new Promise((r) => setTimeout(r, 15));
    active -= 1;
  });
  await Promise.all([critical(), critical(), critical()]);
  assert.equal(maxConcurrent, 1, 'jamais deux sections critiques en parallèle');
});
