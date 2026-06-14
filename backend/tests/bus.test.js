'use strict';

// Bus pub/sub cross-instance (#31) : un message publié atteint tous les handlers
// abonnés (= toutes les instances). On simule deux instances par deux handlers
// distincts sur le même Redis.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'x';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'x';
process.env.PGDATABASE = process.env.PGDATABASE || 'x';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://mock';

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { useMockRedis, flush, closeRedis } = require('./helpers/redis');
const bus = require('../src/realtime/bus');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => { const r = useMockRedis(4); await flush(r); await bus.stop(); });
after(closeRedis);

test('publish atteint tous les handlers abonnés (deux « instances »)', async () => {
  const a = []; const b = [];
  bus.onMessage((m) => a.push(m));
  bus.onMessage((m) => b.push(m));
  await bus.start();

  await bus.publish({ kind: 'state', userId: 'u1', n: 1 });
  await wait(30);

  assert.deepEqual(a, [{ kind: 'state', userId: 'u1', n: 1 }]);
  assert.deepEqual(b, [{ kind: 'state', userId: 'u1', n: 1 }]);
});

test('un handler retiré ne reçoit plus', async () => {
  const got = [];
  const off = bus.onMessage((m) => got.push(m));
  await bus.start();
  off();
  await bus.publish({ kind: 'ping' });
  await wait(30);
  assert.equal(got.length, 0);
});
