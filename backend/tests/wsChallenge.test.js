'use strict';

// Défis entre amis (#45/#47) : invitation (amis acceptés uniquement, ami en
// ligne), acceptation → GameSession directe (sans file) avec le flag rated,
// refus / annulation / expiration, et amicale = pas d'Elo dans l'outcome.

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

// u1 et u2 sont amis ; u3 n'est l'ami de personne.
const FRIENDS = new Set(['u1|u2', 'u2|u1']);

beforeEach(async () => { const r = useMockRedis(10); await flush(r); await bus.stop(); });
after(closeRedis);

async function setup(t, { challengeTtlMs = 60000 } = {}) {
  const recorded = [];
  const server = http.createServer();
  const rt = await attachWebSocketServer(server, {
    heartbeatMs: 0,
    graceMs: 5000,
    sweepMs: 20,    // sweep rapide : l'expiration des défis se déclenche vite
    challengeTtlMs,
    areFriends: async (a, b) => FRIENDS.has(`${a}|${b}`),
    onMatchComplete: (outcome) => recorded.push(outcome),
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  const connect = async (userId, name) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${signToken({ id: userId, username: name })}`);
    const msgs = [];
    ws.on('message', d => msgs.push(JSON.parse(d.toString())));
    await once(ws, 'open');
    return { ws, msgs, send: (o) => ws.send(JSON.stringify(o)) };
  };

  t.after(async () => { rt.stop(); server.close(); await closeRedis(); });
  return { connect, recorded };
}

const lastOf = (msgs, type) => msgs.filter(m => m.t === type).pop();

test('défi : invitation notifiée, acceptation → partie directe (amicale, sans Elo)', async (t) => {
  const { connect, recorded } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  const c2 = await connect('u2', 'Bob');
  await delay(40);

  // (1) Invitation amicale (rated absent → false par défaut).
  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'classic' });
  await delay(50);
  const sent = lastOf(c1.msgs, 'challenge');
  assert.equal(sent.status, 'sent');
  assert.equal(sent.rated, false, 'défaut = amicale');
  const notif = c2.msgs.find(m => m.t === 'notification' && m.kind === 'challenge');
  assert.ok(notif, 'le destinataire est notifié');
  assert.equal(notif.from, 'Alice');
  assert.equal(notif.rated, false);

  // (2) Acceptation → session pour les deux, sans passer par la file.
  c2.send({ t: 'challenge', action: 'accept', challengeId: notif.challengeId });
  await delay(60);
  const session = await sessionStore.sessionForUser('u1');
  assert.ok(session, 'session créée');
  assert.equal(session.rated, false);
  assert.equal((await sessionStore.sessionForUser('u2')).id, session.id);
  assert.ok(lastOf(c1.msgs, 'matchFound'), 'matchFound chez le défieur');
  assert.equal(lastOf(c2.msgs, 'matchFound').opponent, 'Alice');
  assert.equal(lastOf(c2.msgs, 'state').state.rated, false, 'le snapshot porte le type de partie');

  // (3) Fin par forfait : l'outcome est enregistré avec rated:false (pas d'Elo).
  c2.send({ t: 'action', action: { type: 'forfeit' } });
  await delay(50);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].rated, false, 'amicale → recordMatch saura ne pas toucher l’Elo');
});

test('défi classé : rated:true propagé jusqu’à l’outcome', async (t) => {
  const { connect, recorded } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  const c2 = await connect('u2', 'Bob');
  await delay(40);

  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'mondoubleau', rated: true });
  await delay(50);
  const notif = c2.msgs.find(m => m.t === 'notification' && m.kind === 'challenge');
  assert.equal(notif.rated, true);
  assert.equal(notif.variant, 'mondoubleau');

  c2.send({ t: 'challenge', action: 'accept', challengeId: notif.challengeId });
  await delay(60);
  assert.equal((await sessionStore.sessionForUser('u1')).rated, true);

  c1.send({ t: 'action', action: { type: 'forfeit' } });
  await delay(50);
  assert.equal(recorded[0].rated, true);
});

test('défi : refusé hors amitié, hors ligne, ou déjà en partie', async (t) => {
  const { connect } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  const c3 = await connect('u3', 'Zoé');
  await delay(40);

  // (1) u1 et u3 ne sont pas amis.
  c1.send({ t: 'challenge', action: 'invite', to: 'u3', variant: 'classic' });
  await delay(50);
  assert.match(lastOf(c1.msgs, 'error').error, /amis/i);

  // (2) u2 est hors ligne.
  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'classic' });
  await delay(50);
  assert.match(lastOf(c1.msgs, 'error').error, /en ligne/i);

  // (3) Un joueur déjà en partie ne peut ni défier ni être défié.
  await sessionStore.createSession({
    players: [{ userId: 'u1', name: 'Alice' }, { userId: 'uX', name: 'X' }],
    variant: 'classic', target: 3,
  });
  const c2 = await connect('u2', 'Bob');
  await delay(40);
  c2.send({ t: 'challenge', action: 'invite', to: 'u1', variant: 'classic' });
  await delay(50);
  assert.match(lastOf(c2.msgs, 'error').error, /déjà en partie/i);
  void c3;
});

test('défi : refus notifié, annulation notifiée, expiration automatique', async (t) => {
  const { connect } = await setup(t, { challengeTtlMs: 120 });
  const c1 = await connect('u1', 'Alice');
  const c2 = await connect('u2', 'Bob');
  await delay(40);

  // (1) Refus.
  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'classic' });
  await delay(50);
  let notif = c2.msgs.find(m => m.t === 'notification' && m.kind === 'challenge');
  c2.send({ t: 'challenge', action: 'decline', challengeId: notif.challengeId });
  await delay(50);
  assert.equal(lastOf(c1.msgs, 'challenge').status, 'declined');
  assert.equal(await sessionStore.sessionForUser('u1'), null);

  // (2) Annulation par le défieur.
  c2.msgs.length = 0;
  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'classic' });
  await delay(50);
  notif = c2.msgs.find(m => m.t === 'notification' && m.kind === 'challenge');
  c1.send({ t: 'challenge', action: 'cancel', challengeId: notif.challengeId });
  await delay(50);
  assert.ok(c2.msgs.some(m => m.t === 'notification' && m.kind === 'challengeCancelled'));

  // (3) Expiration (TTL 120 ms) : défieur prévenu, défi accepté trop tard → erreur.
  c1.msgs.length = 0; c2.msgs.length = 0;
  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'classic' });
  await delay(50);
  notif = c2.msgs.find(m => m.t === 'notification' && m.kind === 'challenge');
  await delay(150);
  assert.equal(lastOf(c1.msgs, 'challenge').status, 'expired');
  c2.send({ t: 'challenge', action: 'accept', challengeId: notif.challengeId });
  await delay(50);
  assert.match(lastOf(c2.msgs, 'error').error, /introuvable|expiré/i);
  assert.equal(await sessionStore.sessionForUser('u1'), null);
});
