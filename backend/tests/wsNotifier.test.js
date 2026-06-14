'use strict';

// Notifications temps réel (#44) : le pont notifier permet aux routes Express
// de pousser un message au bon utilisateur via le serveur WS, sans connaître
// le transport. Best-effort : destinataire hors ligne = silencieux.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'x';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'x';
process.env.PGDATABASE = process.env.PGDATABASE || 'x';
process.env.PGHOST = process.env.PGHOST || 'localhost';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://mock';

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { WebSocket } = require('ws');

const { useMockRedis, flush, closeRedis } = require('./helpers/redis');
const bus = require('../src/realtime/bus');
const { attachWebSocketServer } = require('../src/realtime/wsServer');
const notifier = require('../src/realtime/notifier');
const { signToken } = require('../src/middleware/auth');

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const once = (em, ev) => new Promise(res => em.once(ev, res));

beforeEach(async () => { const r = useMockRedis(9); await flush(r); await bus.stop(); });
after(closeRedis);

test('notifier : délivre au bon destinataire (tous ses onglets), silencieux hors ligne', async (t) => {
  notifier.reset();
  const server = http.createServer();
  const rt = await attachWebSocketServer(server, { heartbeatMs: 0 });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  const connect = async (userId, name) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${signToken({ id: userId, username: name })}`);
    const msgs = [];
    ws.on('message', d => msgs.push(JSON.parse(d.toString())));
    await once(ws, 'open');
    return { ws, msgs };
  };

  const tab1 = await connect('u1', 'Alice');
  const tab2 = await connect('u1', 'Alice');
  const c2 = await connect('u2', 'Bob');
  t.after(async () => { rt.stop(); server.close(); await closeRedis(); });
  await delay(40);

  // (1) Notification à u1 : reçue sur SES deux onglets, pas chez u2.
  notifier.notifyUser('u1', { kind: 'friendRequest', from: 'Bob' });
  await delay(40);
  for (const tab of [tab1, tab2]) {
    const n = tab.msgs.find(m => m.t === 'notification');
    assert.ok(n, 'chaque onglet du destinataire est notifié');
    assert.equal(n.kind, 'friendRequest');
    assert.equal(n.from, 'Bob');
  }
  assert.ok(!c2.msgs.some(m => m.t === 'notification'), 'les autres ne reçoivent rien');

  // (2) Destinataire hors ligne : aucun crash, simplement perdu (badge en filet).
  assert.doesNotThrow(() => notifier.notifyUser('u-absent', { kind: 'friendRequest', from: 'Bob' }));
});

test('notifier : sans serveur WS enregistré, no-op silencieux', () => {
  notifier.reset();
  assert.doesNotThrow(() => notifier.notifyUser('u1', { kind: 'friendRequest', from: 'X' }));
});
