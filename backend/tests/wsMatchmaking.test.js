'use strict';

// Env requis par config.js, posé avant tout require (aucune DB n'est touchée :
// getRating et onMatchComplete sont injectés).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'x';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'x';
process.env.PGDATABASE = process.env.PGDATABASE || 'x';
process.env.PGHOST = process.env.PGHOST || 'localhost';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://mock';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { WebSocket } = require('ws');

const { useMockRedis, flush, closeRedis } = require('./helpers/redis');
const bus = require('../src/realtime/bus');
const { attachWebSocketServer } = require('../src/realtime/wsServer');
const { signToken } = require('../src/middleware/auth');

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const once = (em, ev) => new Promise(res => em.once(ev, res));

test('matchmaking WS : deux joueurs en file sont appariés et reçoivent leur partie', async (t) => {
  const redis = useMockRedis(6); await flush(redis); await bus.stop();
  const server = http.createServer();
  const ratings = { u1: 1500, u2: 1510 };
  const handle = await attachWebSocketServer(server, {
    tickMs: 15,
    getRating: (userId) => Promise.resolve(ratings[userId] ?? 1500),
    onMatchComplete: () => {}, // pas de DB
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  t.after(async () => { handle.stop(); server.close(); await closeRedis(); });

  const t1 = signToken({ id: 'u1', username: 'Alice' });
  const t2 = signToken({ id: 'u2', username: 'Bob' });
  const ws1 = new WebSocket(`ws://localhost:${port}/ws?token=${t1}`);
  const ws2 = new WebSocket(`ws://localhost:${port}/ws?token=${t2}`);
  const msgs1 = [], msgs2 = [];
  ws1.on('message', d => msgs1.push(JSON.parse(d.toString())));
  ws2.on('message', d => msgs2.push(JSON.parse(d.toString())));
  t.after(() => { ws1.close(); ws2.close(); });

  await Promise.all([once(ws1, 'open'), once(ws2, 'open')]);

  // Les deux rejoignent la file « classique ».
  ws1.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  ws2.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));

  // Laisse la boucle d'appariement tourner.
  await delay(120);

  // (1) Chacun reçoit l'accusé de mise en file.
  assert.ok(msgs1.some(m => m.t === 'queue' && m.status === 'searching'));
  assert.ok(msgs2.some(m => m.t === 'queue' && m.status === 'searching'));

  // (2) Chacun reçoit « match trouvé » avec le nom de l'adversaire.
  const mf1 = msgs1.find(m => m.t === 'matchFound');
  const mf2 = msgs2.find(m => m.t === 'matchFound');
  assert.ok(mf1 && mf2, 'les deux joueurs reçoivent matchFound');
  assert.equal(mf1.opponent, 'Bob');
  assert.equal(mf2.opponent, 'Alice');
  assert.equal(mf1.sessionId, mf2.sessionId);

  // (3) Chacun reçoit l'état initial de SA partie (siège cohérent, main visible).
  const st1 = msgs1.filter(m => m.t === 'state').pop();
  const st2 = msgs2.filter(m => m.t === 'state').pop();
  assert.ok(st1 && st2);
  assert.ok([0, 1].includes(st1.state.you));
  assert.ok(st1.state.players[st1.state.you].hand, 'sa propre main est visible');
  assert.equal(st1.state.players[1 - st1.state.you].hand, undefined, 'la main adverse est masquée');
});
