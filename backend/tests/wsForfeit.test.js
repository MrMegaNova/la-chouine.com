'use strict';

// Abandon / reconnexion en partie PvP (#30) : délai de grâce à la déconnexion,
// notification de l'adversaire, forfait à expiration (enregistré), abandon
// volontaire, et désarmement à la reconnexion. Aucune DB : onMatchComplete
// est injecté (espion). État dans Redis (#31) : on recharge la session depuis
// le store (le sweep ne mute pas l'objet local) ou on lit l'état diffusé.

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

beforeEach(async () => { const r = useMockRedis(8); await flush(r); await bus.stop(); });
after(closeRedis);

// Monte un serveur + une session u1/u2 + deux clients connectés.
async function setup(t, { graceMs = 120 } = {}) {
  const recorded = [];
  const server = http.createServer();
  const rt = await attachWebSocketServer(server, {
    graceMs,
    sweepMs: 20,    // sweep rapide : la grâce expire vite, test déterministe
    heartbeatMs: 0, // pas de ping en test : les déconnexions sont explicites
    onMatchComplete: (outcome) => recorded.push(outcome),
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  const session = await sessionStore.createSession({
    players: [{ userId: 'u1', name: 'Alice' }, { userId: 'u2', name: 'Bob' }],
    variant: 'classic', target: 3,
  });

  const connect = async (userId, name) => {
    const token = signToken({ id: userId, username: name });
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
    const msgs = [];
    ws.on('message', d => msgs.push(JSON.parse(d.toString())));
    await once(ws, 'open');
    return { ws, msgs };
  };

  const c1 = await connect('u1', 'Alice');
  const c2 = await connect('u2', 'Bob');
  await delay(40);

  t.after(async () => {
    rt.stop(); // d'abord : les fermetures qui suivent ne doivent rien armer
    try { c1.ws.close(); c2.ws.close(); } catch { /* déjà fermés */ }
    server.close();
    await closeRedis();
  });
  return { session, c1, c2, connect, recorded };
}

test('déconnexion : l’adversaire est prévenu, puis forfait à l’expiration du délai', async (t) => {
  const { session, c1, c2, connect, recorded } = await setup(t, { graceMs: 100 });

  c2.ws.close();
  await delay(50);

  // (1) Pendant le délai de grâce : notification, partie toujours en cours.
  const notif = c1.msgs.find(m => m.t === 'opponentDisconnected');
  assert.ok(notif, 'l’adversaire restant est prévenu de la déconnexion');
  assert.ok(notif.deadline > Date.now(), 'la notification porte l’échéance');
  assert.equal((await sessionStore.getSession(session.id)).finished, false, 'pas de forfait avant l’échéance');

  // (2) À l'expiration : forfait du déconnecté, diffusion et enregistrement.
  await delay(150);
  const finalState = c1.msgs.filter(m => m.t === 'state').pop();
  assert.equal(finalState.state.finished, true, 'l’état final est diffusé');
  assert.equal(finalState.state.matchResult.forfeit.by, 1);
  assert.equal(finalState.state.matchResult.forfeit.reason, 'timeout');

  assert.equal(recorded.length, 1, 'le match est enregistré (Elo)');
  assert.equal(recorded[0].players.find(p => p.userId === 'u1').won, true);
  assert.equal(recorded[0].players.find(p => p.userId === 'u2').won, false);
  assert.equal(await sessionStore.sessionForUser('u1'), null, 'la session est close');

  // (3) Le déconnecté qui revient trop tard l'apprend via hello.inSession=false.
  const late = await connect('u2', 'Bob');
  await delay(30);
  const hello = late.msgs.find(m => m.t === 'hello');
  assert.equal(hello.inSession, false, 'le revenant tardif sait que la partie est finie');
});

test('reconnexion avant l’échéance : un onglet restant maintient la présence (pas de grâce)', async (t) => {
  const { c1, connect } = await setup(t, { graceMs: 150 });

  const first2 = await connect('u2', 'Bob'); // second onglet de u2
  first2.ws.close();
  // NB : le socket u2 du setup est toujours ouvert → multi-onglets : pas de grâce.
  await delay(60);
  assert.ok(!c1.msgs.some(m => m.t === 'opponentDisconnected'),
    'un onglet restant maintient la présence (pas de délai de grâce)');
});

test('dernier onglet fermé puis reconnexion : opponentReconnected et partie intacte', async (t) => {
  const { session, c1, c2, connect, recorded } = await setup(t, { graceMs: 150 });

  c2.ws.close();
  await delay(40);
  assert.ok(c1.msgs.some(m => m.t === 'opponentDisconnected'));

  const back = await connect('u2', 'Bob');
  await delay(40);
  assert.ok(c1.msgs.some(m => m.t === 'opponentReconnected'),
    'l’adversaire est prévenu du retour');
  assert.equal((await sessionStore.getSession(session.id)).finished, false, 'la partie continue');

  const resumed = back.msgs.filter(m => m.t === 'state').pop();
  assert.ok(resumed, 'le revenant reçoit l’état de la partie en cours');
  assert.equal(resumed.state.you, 1);

  await delay(200); // bien après l'ancienne échéance
  assert.equal((await sessionStore.getSession(session.id)).finished, false, 'le forfait a été désarmé');
  assert.equal(recorded.length, 0);
});

test('abandon volontaire : action forfeit → victoire adverse immédiate, enregistrée', async (t) => {
  const { c1, c2, recorded } = await setup(t);

  c2.ws.send(JSON.stringify({ t: 'action', action: { type: 'forfeit' } }));
  await delay(60);

  for (const c of [c1, c2]) {
    const st = c.msgs.filter(m => m.t === 'state').pop();
    assert.equal(st.state.finished, true, 'les deux joueurs reçoivent l’état final');
    assert.equal(st.state.matchResult.forfeit.by, 1);
    assert.equal(st.state.matchResult.forfeit.reason, 'abandon');
  }
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].players.find(p => p.userId === 'u1').won, true);
  assert.equal(await sessionStore.sessionForUser('u2'), null);
});
