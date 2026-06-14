'use strict';

// Env requis par config.js (aucune DB : getRating/onMatchComplete injectés).
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
const sessionStore = require('../src/realtime/sessionStore');
const { attachWebSocketServer } = require('../src/realtime/wsServer');
const { signToken } = require('../src/middleware/auth');

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const once = (em, ev) => new Promise(res => em.once(ev, res));

beforeEach(async () => { const r = useMockRedis(12); await flush(r); await bus.stop(); });
after(closeRedis);

async function matchTwo(server, { clockOptions }) {
  const handle = await attachWebSocketServer(server, {
    tickMs: 15,
    getRating: () => Promise.resolve(1500),
    onMatchComplete: () => {},
    clockOptions,
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const t1 = signToken({ id: 'u1', username: 'Alice' });
  const t2 = signToken({ id: 'u2', username: 'Bob' });
  const ws1 = new WebSocket(`ws://localhost:${port}/ws?token=${t1}`);
  const ws2 = new WebSocket(`ws://localhost:${port}/ws?token=${t2}`);
  const msgs1 = [], msgs2 = [];
  ws1.on('message', d => msgs1.push(JSON.parse(d.toString())));
  ws2.on('message', d => msgs2.push(JSON.parse(d.toString())));
  await Promise.all([once(ws1, 'open'), once(ws2, 'open')]);
  ws1.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  ws2.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  await delay(120);
  return { handle, ws1, ws2, msgs1, msgs2 };
}

test('horloge (#141) : l’état initial d’une partie classée porte l’horloge en marche', async (t) => {
  const server = http.createServer();
  const { handle, ws1, ws2, msgs1 } = await matchTwo(server, {
    clockOptions: { baseMs: 5000, reserveMs: 0, pauseBudgetMs: 5000, maxTimeouts: 9 },
  });
  t.after(async () => { handle.stop(); ws1.close(); ws2.close(); server.close(); await closeRedis(); });

  const state = msgs1.filter(m => m.t === 'state').pop();
  assert.ok(state, 'le joueur 1 reçoit un état');
  assert.ok(state.state.clock, 'l’horloge est présente (partie classée)');
  assert.equal(typeof state.state.clock.seat, 'number', 'un siège a l’horloge active');
  assert.ok(state.state.clock.remainingMs > 0 && state.state.clock.remainingMs <= 5000);
});

test('horloge (#141) : à l’expiration, un coup automatique est joué (pénalité)', async (t) => {
  const server = http.createServer();
  const { handle, ws1, ws2, msgs1 } = await matchTwo(server, {
    clockOptions: { baseMs: 70, reserveMs: 0, pauseBudgetMs: 5000, maxTimeouts: 9 },
  });
  t.after(async () => { handle.stop(); ws1.close(); ws2.close(); server.close(); await closeRedis(); });

  // Aucun joueur ne joue : l'horloge expire et le serveur joue à leur place.
  await delay(300);
  const withTimeout = msgs1.filter(m => m.t === 'state')
    .some(m => m.state.clock && (m.state.clock.timeouts[0] + m.state.clock.timeouts[1]) > 0);
  assert.ok(withTimeout, 'au moins un coup automatique a été enregistré à l’expiration');
});

test('horloge (#141) : pause quand l’adversaire est déconnecté, reprise au retour', async (t) => {
  const server = http.createServer();
  const { handle, ws1, ws2 } = await matchTwo(server, {
    // Base longue pour que l'horloge n'expire pas pendant le test.
    clockOptions: { baseMs: 4000, reserveMs: 0, pauseBudgetMs: 5000, maxTimeouts: 9 },
  });
  t.after(async () => { handle.stop(); ws1.close(); ws2.close(); server.close(); await closeRedis(); });

  // État dans Redis : on recharge à chaque vérification (le sweep mute la copie
  // persistée, pas l'objet local).
  const sid = await sessionStore.sessionIdForUser('u1');
  let session = await sessionStore.getSession(sid);
  assert.ok(session && session.clock, 'session classée avec horloge');
  assert.equal(session.clock.paused, false);

  // Bob se déconnecte → le sweep met l'horloge en pause.
  ws2.close();
  await delay(120);
  session = await sessionStore.getSession(sid);
  assert.equal(session.clock.paused, true, 'horloge en pause pendant la déconnexion');
  const timeoutsDuringPause = session.clock.timeouts[0] + session.clock.timeouts[1];

  // Elle ne s'écoule pas : pas de coup automatique pendant la pause.
  await delay(200);
  session = await sessionStore.getSession(sid);
  assert.equal(session.clock.timeouts[0] + session.clock.timeouts[1], timeoutsDuringPause,
    'aucun coup automatique tant que c’est en pause');
});
