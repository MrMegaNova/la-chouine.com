'use strict';

// Tickets WebSocket éphémères (#120) : le JWT ne transite plus dans l'URL du WS.
// Un ticket à usage unique (TTL court) authentifie l'ouverture du socket.

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
const ticketStore = require('../src/realtime/ticketStore');
const { attachWebSocketServer } = require('../src/realtime/wsServer');

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const once = (em, ev) => new Promise(res => em.once(ev, res));

beforeEach(async () => { const r = useMockRedis(13); await flush(r); await bus.stop(); });
after(closeRedis);

test('ticketStore : usage unique (consume supprime le ticket)', async () => {
  const ticket = await ticketStore.issue({ id: 'u1', username: 'Alice', ver: 0 });
  assert.equal(typeof ticket, 'string');
  const first = await ticketStore.consume(ticket);
  assert.deepEqual(first, { id: 'u1', username: 'Alice', ver: 0 });
  assert.equal(await ticketStore.consume(ticket), null, 'un ticket ne sert qu’une fois');
  assert.equal(await ticketStore.consume('inexistant'), null);
});

async function server(t) {
  const srv = http.createServer();
  const handle = await attachWebSocketServer(srv, { heartbeatMs: 0 });
  await new Promise(r => srv.listen(0, r));
  t.after(async () => { handle.stop(); srv.close(); await closeRedis(); });
  return srv.address().port;
}

test('WS : connexion par ?ticket= valide → hello, ticket consommé', async (t) => {
  const port = await server(t);
  const ticket = await ticketStore.issue({ id: 'u1', username: 'Alice', ver: 0 });

  const ws = new WebSocket(`ws://localhost:${port}/ws?ticket=${ticket}`);
  const msgs = [];
  ws.on('message', d => msgs.push(JSON.parse(d.toString())));
  await once(ws, 'open');
  await delay(40);
  assert.ok(msgs.some(m => m.t === 'hello' && m.userId === 'u1'), 'authentifié via ticket');
  ws.close();

  // Le même ticket ne peut pas être réutilisé (déjà consommé) → refus.
  const ws2 = new WebSocket(`ws://localhost:${port}/ws?ticket=${ticket}`);
  const code = await new Promise(res => ws2.on('close', c => res(c)));
  assert.equal(code, 4001, 'ticket déjà consommé → connexion refusée');
});

test('WS : ticket invalide → refus (4001)', async (t) => {
  const port = await server(t);
  const ws = new WebSocket(`ws://localhost:${port}/ws?ticket=bidon`);
  const code = await new Promise(res => ws.on('close', c => res(c)));
  assert.equal(code, 4001);
});
