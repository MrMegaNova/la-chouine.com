'use strict';

// Présence & grâce cross-instance (#31) : suivi online (plusieurs instances par
// joueur), compteurs agrégés, et deadlines de grâce indexées pour le sweep.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'x';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'x';
process.env.PGDATABASE = process.env.PGDATABASE || 'x';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://mock';

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { useMockRedis, flush, closeRedis } = require('./helpers/redis');
const presence = require('../src/realtime/presenceStore');
const mm = require('../src/realtime/matchmakingStore');
const sessions = require('../src/realtime/sessionStore');

let redis;
beforeEach(async () => { redis = useMockRedis(5); await flush(redis); });
after(closeRedis);

test('online : un joueur est en ligne tant qu’au moins une instance le déclare', async () => {
  await presence.addOnline('u1');
  assert.equal(await presence.isOnline('u1'), true);
  assert.equal(await presence.onlineCount(), 1);
  await presence.removeOnline('u1');
  assert.equal(await presence.isOnline('u1'), false);
  assert.equal(await presence.onlineCount(), 0);
});

test('counts : agrège online, file et en partie', async () => {
  await presence.addOnline('u1');
  await presence.addOnline('u2');
  await mm.join({ userId: 'u1', name: 'A', rating: 1500, variant: 'classic' });
  await sessions.createSession({ players: [{ userId: 'u3', name: 'C' }, { userId: 'u4', name: 'D' }] });
  const c = await presence.counts();
  assert.equal(c.online, 2);
  assert.equal(c.inQueue, 1);
  assert.equal(c.inGame, 2);
});

test('userPresence : online + en partie', async () => {
  await presence.addOnline('u3');
  await sessions.createSession({ players: [{ userId: 'u3', name: 'C' }, { userId: 'u4', name: 'D' }] });
  assert.deepEqual(await presence.userPresence('u3'), { online: true, inGame: true });
  assert.deepEqual(await presence.userPresence('u4'), { online: false, inGame: true });
  assert.deepEqual(await presence.userPresence('u9'), { online: false, inGame: false });
});

test('grâce : deadline posée, listée, puis levée', async () => {
  await presence.setGrace('u1', 12345);
  assert.equal(await presence.getGrace('u1'), 12345);
  assert.deepEqual(await presence.listGraces(), ['u1']);
  await presence.clearGrace('u1');
  assert.equal(await presence.getGrace('u1'), null);
  assert.deepEqual(await presence.listGraces(), []);
});
