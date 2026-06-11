'use strict';

// Présence (#43) : compteurs { online, inQueue, inGame } — dédupliqués par
// utilisateur (multi-onglets = 1), diffusés aux connectés et exposés aux
// routes via le module presence. Jamais de noms, seulement des nombres.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'x';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'x';
process.env.PGDATABASE = process.env.PGDATABASE || 'x';
process.env.PGHOST = process.env.PGHOST || 'localhost';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { WebSocket } = require('ws');

const { attachWebSocketServer } = require('../src/realtime/wsServer');
const registry = require('../src/realtime/sessionRegistry');
const presence = require('../src/realtime/presence');
const { signToken } = require('../src/middleware/auth');

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const once = (em, ev) => new Promise(res => em.once(ev, res));

async function setup(t) {
  registry.reset();
  presence.reset();
  const server = http.createServer();
  const rt = attachWebSocketServer(server, {
    heartbeatMs: 0,
    graceMs: 5000,
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

  t.after(() => { rt.stop(); server.close(); });
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

  assert.deepEqual(presence.getPresence(), { online: 2, inQueue: 0, inGame: 0 });
  const seen = lastPresence(c2.msgs);
  assert.ok(seen, 'les connectés reçoivent la présence');
  assert.equal(seen.online, 2, 'multi-onglets compte pour 1');

  // (2) Fermer UN onglet de u1 ne change rien ; fermer le dernier → online = 1.
  tab1.ws.close();
  await delay(350);
  assert.equal(presence.getPresence().online, 2);
  tab2.ws.close();
  await delay(350);
  assert.equal(presence.getPresence().online, 1);
  assert.equal(lastPresence(c2.msgs).online, 1, 'la déconnexion est diffusée');
});

test('présence : file d’attente puis partie reflétées dans les compteurs', async (t) => {
  const { connect } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  const c2 = await connect('u2', 'Bob');

  // (1) u1 rejoint la file → inQueue = 1.
  c1.ws.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  await delay(350);
  assert.equal(presence.getPresence().inQueue, 1);
  assert.equal(lastPresence(c2.msgs).inQueue, 1);

  // (2) u2 rejoint → appariement (boucle ~1 s) → inGame = 2, file vide.
  c2.ws.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  await delay(1500);
  assert.deepEqual(presence.getPresence(), { online: 2, inQueue: 0, inGame: 2 });
  assert.equal(lastPresence(c1.msgs).inGame, 2);
});

test('présence individuelle (#46) : en ligne, en partie, hors ligne', async (t) => {
  const { connect } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  await connect('u2', 'Bob');
  await delay(40);

  // (1) Connectés mais pas en partie.
  assert.deepEqual(presence.userPresence('u1'), { online: true, inGame: false });
  assert.deepEqual(presence.userPresence('absent'), { online: false, inGame: false });

  // (2) En partie après appariement.
  c1.ws.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  await delay(100);
  const c2bis = await connect('u2', 'Bob'); // déjà compté, juste pour envoyer
  c2bis.ws.send(JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' }));
  await delay(1500);
  assert.deepEqual(presence.userPresence('u1'), { online: true, inGame: true });

  // (3) Déconnexion totale → hors ligne (même si la session de jeu persiste).
  c1.ws.close();
  await delay(60);
  assert.equal(presence.userPresence('u1').online, false);
  assert.equal(presence.userPresence('u1').inGame, true, 'la partie attend son retour (délai de grâce #30)');
});

test('présence : sans fournisseur (serveur WS arrêté/absent), des zéros sans erreur', () => {
  presence.reset();
  assert.deepEqual(presence.getPresence(), { online: 0, inQueue: 0, inGame: 0 });
  assert.deepEqual(presence.userPresence('u1'), { online: false, inGame: false });
});
