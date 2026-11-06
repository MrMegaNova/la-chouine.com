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
const { getClient } = require('../src/redis/client');
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
    const client = { ws, msgs, send: (o) => ws.send(JSON.stringify(o)) };
    // `hello` conclut la mise en ligne côté serveur : le joueur est alors visible.
    await next(client, m => m.t === 'hello', 'hello', 0);
    return client;
  };

  t.after(async () => { rt.stop(); server.close(); await closeRedis(); });
  return { connect, recorded };
}

// Attend un état observable ; l'échéance ne sert qu'à faire échouer le test.
async function waitFor(pred, what, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await pred();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`état non atteint : ${what}`);
    await delay(5);
  }
}

// Prochain message du client vérifiant `pred`, reçu à partir de l'indice `from`
// (par défaut : à partir de maintenant, donc à appeler AVANT l'envoi).
function next(client, pred, what, from = client.msgs.length) {
  return waitFor(() => client.msgs.slice(from).find(pred), what);
}
const nextOf = (client, type, what = type) => next(client, m => m.t === type, what);
const nextNotif = (client, kind) => next(client, m => m.t === 'notification' && m.kind === kind, `notification ${kind}`);


test('défi : invitation notifiée, acceptation → partie directe (amicale, sans Elo)', async (t) => {
  const { connect, recorded } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  const c2 = await connect('u2', 'Bob');

  // (1) Invitation amicale (rated absent → false par défaut).
  const sentP = next(c1, m => m.t === 'challenge' && m.status === 'sent', 'accusé d’envoi');
  const notifP = nextNotif(c2, 'challenge');
  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'classic' });
  const sent = await sentP;
  assert.equal(sent.rated, false, 'défaut = amicale');
  const notif = await notifP;
  assert.equal(notif.from, 'Alice');
  assert.equal(notif.rated, false);

  // (2) Acceptation → session pour les deux, sans passer par la file.
  const found1 = nextOf(c1, 'matchFound');
  const found2 = nextOf(c2, 'matchFound');
  const state2 = nextOf(c2, 'state');
  c2.send({ t: 'challenge', action: 'accept', challengeId: notif.challengeId });
  await found1;
  assert.equal((await found2).opponent, 'Alice');
  assert.equal((await state2).state.rated, false, 'le snapshot porte le type de partie');
  const session = await sessionStore.sessionForUser('u1');
  assert.ok(session, 'session créée');
  assert.equal(session.rated, false);
  assert.equal((await sessionStore.sessionForUser('u2')).id, session.id);

  // (3) Fin par forfait : l'outcome est enregistré avec rated:false (pas d'Elo).
  c2.send({ t: 'action', action: { type: 'forfeit' } });
  await waitFor(() => recorded.length > 0, 'enregistrement du match');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].rated, false, 'amicale → recordMatch saura ne pas toucher l’Elo');
});

test('défi classé : rated:true propagé jusqu’à l’outcome', async (t) => {
  const { connect, recorded } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  const c2 = await connect('u2', 'Bob');

  const notifP = nextNotif(c2, 'challenge');
  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'mondoubleau', rated: true });
  const notif = await notifP;
  assert.equal(notif.rated, true);
  assert.equal(notif.variant, 'mondoubleau');

  const found = nextOf(c1, 'matchFound');
  c2.send({ t: 'challenge', action: 'accept', challengeId: notif.challengeId });
  await found;
  assert.equal((await sessionStore.sessionForUser('u1')).rated, true);

  c1.send({ t: 'action', action: { type: 'forfeit' } });
  await waitFor(() => recorded.length > 0, 'enregistrement du match');
  assert.equal(recorded[0].rated, true);
});

test('défi : refusé hors amitié, hors ligne, ou déjà en partie', async (t) => {
  const { connect } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  await connect('u3', 'Zoé');

  // (1) u1 et u3 ne sont pas amis.
  let err = nextOf(c1, 'error');
  c1.send({ t: 'challenge', action: 'invite', to: 'u3', variant: 'classic' });
  assert.match((await err).error, /amis/i);

  // (2) u2 est hors ligne.
  err = nextOf(c1, 'error');
  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'classic' });
  assert.match((await err).error, /en ligne/i);

  // (3) Un joueur déjà en partie ne peut ni défier ni être défié.
  await sessionStore.createSession({
    players: [{ userId: 'u1', name: 'Alice' }, { userId: 'uX', name: 'X' }],
    variant: 'classic', target: 3,
  });
  const c2 = await connect('u2', 'Bob');
  err = nextOf(c2, 'error');
  c2.send({ t: 'challenge', action: 'invite', to: 'u1', variant: 'classic' });
  assert.match((await err).error, /déjà en partie/i);
});

test('défi : un non-ami renvoie toujours « amis », sans fuiter son statut (#123)', async (t) => {
  const { connect } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  await connect('u3', 'Zoé'); // non-ami, EN LIGNE

  // (1) Non-ami en ligne → « amis » (pas « en partie » ni « pas en ligne »).
  let err = nextOf(c1, 'error');
  c1.send({ t: 'challenge', action: 'invite', to: 'u3', variant: 'classic' });
  assert.match((await err).error, /amis/i);

  // (2) Non-ami MIS EN PARTIE → toujours « amis », jamais « déjà en partie »
  // (sinon on sonderait le statut de n'importe quel userId).
  await sessionStore.createSession({
    players: [{ userId: 'u3', name: 'Zoé' }, { userId: 'uY', name: 'Y' }],
    variant: 'classic', target: 3,
  });
  err = nextOf(c1, 'error');
  c1.send({ t: 'challenge', action: 'invite', to: 'u3', variant: 'classic' });
  assert.match((await err).error, /amis/i, 'aucune fuite du statut « en partie » d’un non-ami');

  // (3) Non-ami HORS LIGNE → même réponse « amis ».
  err = nextOf(c1, 'error');
  c1.send({ t: 'challenge', action: 'invite', to: 'u-inconnu', variant: 'classic' });
  assert.match((await err).error, /amis/i);
});

test('défi : refus notifié, annulation notifiée, expiration automatique', async (t) => {
  const { connect } = await setup(t, { challengeTtlMs: 120 });
  const c1 = await connect('u1', 'Alice');
  const c2 = await connect('u2', 'Bob');

  // (1) Refus.
  let notifP = nextNotif(c2, 'challenge');
  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'classic' });
  let notif = await notifP;
  const declined = next(c1, m => m.t === 'challenge' && m.status === 'declined', 'refus');
  c2.send({ t: 'challenge', action: 'decline', challengeId: notif.challengeId });
  await declined;
  assert.equal(await sessionStore.sessionForUser('u1'), null);

  // (2) Annulation par le défieur.
  notifP = nextNotif(c2, 'challenge');
  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'classic' });
  notif = await notifP;
  const cancelled = nextNotif(c2, 'challengeCancelled');
  c1.send({ t: 'challenge', action: 'cancel', challengeId: notif.challengeId });
  await cancelled;

  // (3) Expiration (TTL 120 ms) : défieur prévenu, défi accepté trop tard → erreur.
  notifP = nextNotif(c2, 'challenge');
  const expired = next(c1, m => m.t === 'challenge' && m.status === 'expired', 'expiration');
  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'classic' });
  notif = await notifP;
  await expired;
  const err = nextOf(c2, 'error');
  c2.send({ t: 'challenge', action: 'accept', challengeId: notif.challengeId });
  assert.match((await err).error, /introuvable|expiré/i);
  assert.equal(await sessionStore.sessionForUser('u1'), null);
});

test('défi (#235) : la déconnexion du destinataire annule le défi reçu', async (t) => {
  const { connect } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  const c2 = await connect('u2', 'Bob');

  const notifP = nextNotif(c2, 'challenge');
  c1.send({ t: 'challenge', action: 'invite', to: 'u2', variant: 'classic' });
  const notif = await notifP;

  const cancelled = next(c1, m => m.t === 'challenge' && m.status === 'cancelled', 'annulation');
  c2.ws.close();
  assert.equal((await cancelled).challengeId, notif.challengeId);
  const r = getClient();
  assert.equal(await r.exists(`chal:${notif.challengeId}`), 0);
  assert.equal(await r.zcard('chal:exp'), 0);
  assert.equal(await r.scard('chal:to:u2'), 0);
  assert.equal(await r.exists('chal:from:u1'), 0);
});

test('défi (#235) : un défi de l’ancien index expire toujours, un défi valide y est repris', async (t) => {
  const { connect } = await setup(t);
  const c1 = await connect('u1', 'Alice');
  const r = getClient();
  // Défis créés avant le déploiement : seulement dans l'ancien ensemble `chal:ids`.
  await r.hset('chal:vieux', { id: 'vieux', from: 'u1', fromName: 'Alice', to: 'u2', variant: 'classic', rated: '', expiresAt: Date.now() - 1000 });
  await r.set('chal:from:u1', 'vieux');
  await r.hset('chal:valide', { id: 'valide', from: 'u9', fromName: 'Z', to: 'u2', variant: 'classic', rated: '', expiresAt: Date.now() + 60_000 });
  await r.sadd('chal:ids', 'vieux', 'valide');

  await next(c1, m => m.t === 'challenge' && m.status === 'expired' && m.challengeId === 'vieux', 'expiration de l’ancien défi');
  await waitFor(async () => (await r.scard('chal:ids')) === 0, 'ancien index vidé');
  assert.equal(await r.exists('chal:vieux'), 0);
  assert.equal(await r.zscore('chal:exp', 'valide') !== null, true, 'défi valide repris');
  assert.deepEqual(await r.smembers('chal:to:u2'), ['valide']);
});
