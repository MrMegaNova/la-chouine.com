'use strict';

// Présence (#43) : compteurs { online, inQueue, inGame } — dédupliqués par
// utilisateur (multi-onglets = 1), agrégés depuis Redis (#31, multi-instance) et
// diffusés aux connectés. Jamais de noms, seulement des nombres.

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
const presenceStore = require('../src/realtime/presenceStore');
const { attachWebSocketServer } = require('../src/realtime/wsServer');
const { signToken } = require('../src/middleware/auth');

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const once = (em, ev) => new Promise(res => em.once(ev, res));

beforeEach(async () => { const r = useMockRedis(11); await flush(r); await bus.stop(); });
after(closeRedis);

async function setup(t) {
  const server = http.createServer();
  const rt = await attachWebSocketServer(server, {
    heartbeatMs: 0,
    graceMs: 5000,
    tickMs: 30,     // appariement rapide
    getRating: async () => 1500, // pas de DB en test
    onMatchComplete: () => {},
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  const connect = async (userId, name) => {
    const token = signToken({ id: userId, username: name });
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
    const msgs = [];
    ws.on('message', d => msgs.push(JSON.parse(d.toString())));
    await once(ws, 'open');
    return { ws, msgs };
  };

  t.after(async () => { rt.stop(); server.close(); await closeRedis(); });
  return { connect, rt };
}

const lastPresence = (msgs) => msgs.filter(m => m.t === 'presence').pop();

test('présence : dédupliquée par joueur, poussée à la connexion et à la déconnexion', async (t) => {
  const { connect } = await setup(t);

  // (1) u1 sur DEUX onglets + u2 → online = 2 (pas 3).
  const tab1 = await connect('u1', 'Alice');
  const tab2 = await connect('u1', 'Alice');
  const c2 = await connect('u2', 'Bob');
  await delay(350); // > debounce (250 ms)

  assert.deepEqual(await presenceStore.counts(), { online: 2, inQueue: 0, inGame: 0 });
  const seen = lastPresence(c2.msgs);
  assert.ok(seen, 'les connectés reçoivent la présence');
  assert.equal(seen.online, 2, 'multi-onglets compte pour 1');

  // (2) Fermer UN onglet de u1 ne change rien ; fermer le dernier → online = 1.
  tab1.ws.close();
  await delay(350);
  assert.equal((await presenceStore.counts()).online, 2);
  tab2.ws.close();
  await delay(350);
  assert.equal((await presenceStore.counts()).online, 1);
  assert.equal(lastPresence(c2.msgs).online, 1, 'la déconnexion est diffusée');
});

test('présence : file d’attente puis partie reflétées dans les compteurs', async (t) => {
  const { connect } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  const c2 = await connect('u2', 'Bob');

  // (1) u1 rejoint la file → inQueue = 1.
  c1.ws.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  await delay(350);
  assert.equal((await presenceStore.counts()).inQueue, 1);
  assert.equal(lastPresence(c2.msgs).inQueue, 1);

  // (2) u2 rejoint → appariement → inGame = 2, file vide.
  c2.ws.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  await delay(400);
  assert.deepEqual(await presenceStore.counts(), { online: 2, inQueue: 0, inGame: 2 });
  assert.equal(lastPresence(c1.msgs).inGame, 2);
});

test('présence individuelle (#46) : en ligne, en partie, hors ligne', async (t) => {
  const { connect } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  await connect('u2', 'Bob');
  await delay(40);

  // (1) Connectés mais pas en partie.
  assert.deepEqual(await presenceStore.userPresence('u1'), { online: true, inGame: false });
  assert.deepEqual(await presenceStore.userPresence('absent'), { online: false, inGame: false });

  // (2) En partie après appariement.
  c1.ws.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  await delay(60);
  const c2bis = await connect('u2', 'Bob'); // déjà compté, juste pour envoyer
  c2bis.ws.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  await delay(400);
  assert.deepEqual(await presenceStore.userPresence('u1'), { online: true, inGame: true });

  // (3) Déconnexion totale → hors ligne (même si la session de jeu persiste).
  c1.ws.close();
  await delay(80);
  assert.equal((await presenceStore.userPresence('u1')).online, false);
  assert.equal((await presenceStore.userPresence('u1')).inGame, true, 'la partie attend son retour (délai de grâce #30)');
});

test('présence : Redis vide → compteurs à zéro', async () => {
  assert.deepEqual(await presenceStore.counts(), { online: 0, inQueue: 0, inGame: 0 });
  assert.deepEqual(await presenceStore.userPresence('u1'), { online: false, inGame: false });
});
