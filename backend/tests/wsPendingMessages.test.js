'use strict';

// Messages reçus pendant l'authentification du WebSocket (#298) : un client
// peut écrire dès `open`, alors que le serveur attend encore le ticket, la base
// ou Redis. Ces messages sont gardés en file (bornée), puis traités dans l'ordre
// après `hello`, ou jetés si le client est refusé ou s'il part entre-temps.
//
// Les étapes lentes sont retenues par des portes que le test ouvre lui-même :
// le déroulement ne dépend d'aucune durée fixe.

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
const matchmakingStore = require('../src/realtime/matchmakingStore');
const presenceStore = require('../src/realtime/presenceStore');
const { attachWebSocketServer } = require('../src/realtime/wsServer');
const { signToken } = require('../src/middleware/auth');

const JOIN = JSON.stringify({ t: 'queue', action: 'join', variant: 'classic' });
const LEAVE = JSON.stringify({ t: 'queue', action: 'leave' });
const SYNC = JSON.stringify({ t: 'sync' });

function gate() {
  let open;
  const opened = new Promise(r => { open = r; });
  return { opened, open };
}

// Attend un état observable. L'échéance ne sert qu'à faire échouer le test.
async function waitFor(pred, what, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await pred()) return;
    if (Date.now() > deadline) assert.fail(`état non atteint : ${what}`);
    await new Promise(r => setTimeout(r, 5));
  }
}

beforeEach(async () => { const r = useMockRedis(1); await flush(r); await bus.stop(); });
after(closeRedis);

// Serveur dont l'authentification de `u1` reste bloquée tant que `authGate`
// n'est pas ouverte. `ctx.arrived` compte les messages reçus côté serveur, pour
// ouvrir la porte seulement une fois qu'ils sont bien arrivés.
async function startServer(t, { allow = true, ...opts } = {}) {
  const authGate = gate();
  const ctx = { authGate, arrived: 0, ratingCalls: 0, serverSocket: null };
  const srv = http.createServer();
  const handle = await attachWebSocketServer(srv, {
    heartbeatMs: 0,
    getRating: async () => { ctx.ratingCalls += 1; return 1500; },
    validateUser: async (user) => {
      if (user.id !== 'u1') return true;
      await authGate.opened;
      return allow;
    },
    onMatchComplete: () => {},
    ...opts,
  });
  handle.wss.on('connection', (ws) => {
    // La sonde (authOfU1Settled) ne doit pas remplacer le socket de `u1`.
    if (!ctx.serverSocket) ctx.serverSocket = ws;
    ws.on('message', () => { ctx.arrived += 1; });
  });
  await new Promise(r => srv.listen(0, r));
  ctx.port = srv.address().port;
  ctx.handle = handle;
  t.after(() => { handle.stop(); srv.close(); });
  return ctx;
}

// Client qui envoie `messages` dès l'ouverture du socket.
function connect(t, ctx, { id = 'u1', messages = [], query } = {}) {
  const auth = query || `token=${signToken({ id, username: id })}`;
  const ws = new WebSocket(`ws://localhost:${ctx.port}/ws?${auth}`);
  const client = { ws, msgs: [], closeCode: null };
  ws.on('message', d => client.msgs.push(JSON.parse(d.toString())));
  ws.on('close', (code) => { client.closeCode = code; });
  ws.on('error', () => {});
  ws.on('open', () => { for (const m of messages) ws.send(m); });
  t.after(() => ws.terminate());
  return client;
}

// Réponses du serveur, sans les annonces de connexion.
const replies = (client) => client.msgs.filter(m => m.t !== 'hello' && m.t !== 'presence');

// Une fois `u1` libéré, la connexion d'un autre joueur fait plus d'allers-retours
// Redis que la fin d'authentification de `u1` : son `hello` prouve que le serveur
// en a fini avec `u1`, ce qui permet de vérifier une absence.
async function authOfU1Settled(t, ctx) {
  const probe = connect(t, ctx, { id: 'sonde' });
  await waitFor(() => probe.msgs.some(m => m.t === 'hello'), 'hello de la sonde');
}

test('queue join envoyé dès open : le joueur est bien mis en file', async (t) => {
  const ctx = await startServer(t);
  const client = connect(t, ctx, { messages: [JOIN] });

  await waitFor(() => ctx.arrived === 1, 'message reçu pendant l’authentification');
  assert.equal(client.msgs.length, 0, 'authentification encore en cours');
  ctx.authGate.open();

  await waitFor(() => client.msgs.some(m => m.t === 'queue'), 'accusé de mise en file');
  assert.equal(client.msgs[0].t, 'hello', 'hello précède le traitement du message');
  assert.equal(client.msgs.find(m => m.t === 'queue').status, 'searching');
  assert.equal(await matchmakingStore.has('u1'), true);

  // La suite de la connexion fonctionne normalement.
  client.ws.send(LEAVE);
  await waitFor(() => replies(client).some(m => m.status === 'left'), 'sortie de file');
  assert.equal(await matchmakingStore.has('u1'), false);
});

test('les messages en attente sont traités dans leur ordre d’arrivée', async (t) => {
  const ctx = await startServer(t);
  const client = connect(t, ctx, { messages: [JOIN, LEAVE, SYNC] });

  await waitFor(() => ctx.arrived === 3, 'trois messages reçus');
  ctx.authGate.open();

  await waitFor(() => replies(client).length === 3, 'trois réponses');
  assert.deepEqual(
    replies(client).map(m => m.status || m.error),
    ['searching', 'left', 'Aucune partie en cours.'],
  );
  assert.equal(await matchmakingStore.has('u1'), false, 'le dernier mot revient à leave');
});

test('un message reçu pendant le traitement de la file attend son tour', async (t) => {
  const ratingGate = gate();
  let ratingEntered = false;
  const ctx = await startServer(t, {
    getRating: async () => { ratingEntered = true; await ratingGate.opened; return 1500; },
  });
  const client = connect(t, ctx, { messages: [JOIN] });

  await waitFor(() => ctx.arrived === 1, 'join reçu');
  ctx.authGate.open();
  await waitFor(() => ratingEntered, 'join en cours de traitement');

  client.ws.send(LEAVE);
  await waitFor(() => ctx.arrived === 2, 'leave reçu');
  ratingGate.open();

  await waitFor(() => replies(client).length === 2, 'deux réponses');
  assert.deepEqual(replies(client).map(m => m.status), ['searching', 'left']);
  assert.equal(await matchmakingStore.has('u1'), false, 'pas de joueur fantôme en file');
});

test('client refusé après l’attente : aucun message traité', async (t) => {
  const ctx = await startServer(t, { allow: false });
  const client = connect(t, ctx, { messages: [JOIN, SYNC] });

  await waitFor(() => ctx.arrived === 2, 'messages reçus');
  ctx.authGate.open();

  await waitFor(() => client.closeCode === 4001, 'fermeture 4001');
  assert.deepEqual(client.msgs, [{ t: 'error', error: 'Authentification requise.' }]);
  assert.equal(ctx.ratingCalls, 0);
  assert.equal(await matchmakingStore.has('u1'), false);
  assert.equal(await presenceStore.isOnline('u1'), false);
  assert.equal(ctx.handle.sockets.has('u1'), false);
});

test('ticket invalide : aucun message traité', async (t) => {
  const ctx = await startServer(t);
  const client = connect(t, ctx, { query: 'ticket=inexistant', messages: [JOIN] });

  await waitFor(() => client.closeCode === 4001, 'fermeture 4001');
  assert.deepEqual(client.msgs, [{ t: 'error', error: 'Authentification requise.' }]);
  assert.equal(ctx.ratingCalls, 0);
});

test('borne du nombre de messages : fermeture et rien de traité', async (t) => {
  const ctx = await startServer(t, { pendingMaxMessages: 3 });
  const client = connect(t, ctx, { messages: [JOIN, JOIN, JOIN, JOIN] });

  await waitFor(() => client.closeCode === 4002, 'fermeture 4002');
  ctx.authGate.open();
  await authOfU1Settled(t, ctx);

  assert.equal(ctx.ratingCalls, 0);
  assert.equal(await matchmakingStore.has('u1'), false);
  assert.equal(await presenceStore.isOnline('u1'), false);
  assert.equal(ctx.handle.sockets.has('u1'), false);
});

test('la borne du nombre de messages laisse passer la limite exacte', async (t) => {
  const ctx = await startServer(t, { pendingMaxMessages: 3 });
  const client = connect(t, ctx, { messages: [SYNC, SYNC, SYNC] });

  await waitFor(() => ctx.arrived === 3, 'trois messages reçus');
  ctx.authGate.open();
  await waitFor(() => replies(client).length === 3, 'trois réponses');
  assert.equal(client.closeCode, null);
});

test('borne de la taille cumulée : fermeture et rien de traité', async (t) => {
  const ctx = await startServer(t, { pendingMaxBytes: JOIN.length + 1 });
  const client = connect(t, ctx, { messages: [JOIN, JOIN] });

  await waitFor(() => client.closeCode === 4002, 'fermeture 4002');
  ctx.authGate.open();
  await authOfU1Settled(t, ctx);

  assert.equal(ctx.ratingCalls, 0);
  assert.equal(ctx.handle.sockets.has('u1'), false);
});

test('un message seul au-delà de la borne de taille est refusé', async (t) => {
  const ctx = await startServer(t, { pendingMaxBytes: 16 });
  const client = connect(t, ctx, { messages: ['x'.repeat(17)] });

  await waitFor(() => client.closeCode === 4002, 'fermeture 4002');
});

test('anti-flood (#124) : appliqué dès l’arrivée, sans second débit au traitement', async (t) => {
  const ctx = await startServer(t, { msgBurst: 2, msgRatePerSec: 0 });
  const client = connect(t, ctx, { messages: [JOIN, LEAVE, SYNC, SYNC] });

  await waitFor(() => ctx.arrived === 4, 'quatre messages reçus');
  // Les messages excédentaires sont rejetés sans attendre l'authentification.
  await waitFor(() => client.msgs.filter(m => m.code === 'RATE_LIMIT').length === 2, 'deux rejets');
  ctx.authGate.open();

  await waitFor(() => replies(client).length === 4, 'les deux réponses restantes');
  assert.deepEqual(replies(client).slice(2).map(m => m.status), ['searching', 'left']);
  assert.equal(client.closeCode, null);
});

test('anti-flood (#124) : l’exclusion s’applique pendant l’authentification', async (t) => {
  const ctx = await startServer(t, { msgBurst: 1, msgRatePerSec: 0, msgFloodKick: 2 });
  const client = connect(t, ctx, { messages: [SYNC, SYNC, SYNC] });

  await waitFor(() => client.closeCode === 4002, 'fermeture 4002');
  ctx.authGate.open();
  await authOfU1Settled(t, ctx);
  assert.equal(ctx.handle.sockets.has('u1'), false);
});

test('déconnexion pendant l’authentification : rien n’est enregistré ni traité', async (t) => {
  const ctx = await startServer(t);
  const client = connect(t, ctx, { messages: [JOIN] });

  await waitFor(() => ctx.arrived === 1, 'join reçu');
  const serverClosed = new Promise(r => ctx.serverSocket.once('close', r));
  client.ws.terminate();
  await serverClosed;
  ctx.authGate.open();
  await authOfU1Settled(t, ctx);

  assert.equal(ctx.ratingCalls, 0);
  assert.equal(await matchmakingStore.has('u1'), false);
  assert.equal(await presenceStore.isOnline('u1'), false);
  assert.equal(ctx.handle.sockets.has('u1'), false);
});

test('trame invalide pendant l’authentification : le serveur survit', async (t) => {
  const ctx = await startServer(t);
  const client = connect(t, ctx);

  await new Promise(r => client.ws.once('open', r));
  await waitFor(() => ctx.serverSocket, 'socket côté serveur');
  const serverClosed = new Promise(r => ctx.serverSocket.once('close', r));
  client.ws._socket.write(Buffer.from([0xff, 0xff, 0xff, 0xff]));
  await serverClosed;
  ctx.authGate.open();
  await authOfU1Settled(t, ctx);

  assert.equal(ctx.handle.sockets.has('u1'), false);
  assert.equal(await presenceStore.isOnline('u1'), false);
});

test('déconnexion pendant la mise en ligne : le joueur ne reste pas marqué en ligne', async (t) => {
  const onlineGate = gate();
  let onlineEntered = false;
  let onlineDone = false;
  const realAddOnline = presenceStore.addOnline;
  t.mock.method(presenceStore, 'addOnline', async (uid) => {
    onlineEntered = true;
    await onlineGate.opened;
    await realAddOnline(uid);
    onlineDone = true;
  });
  const ctx = await startServer(t);
  const client = connect(t, ctx, { messages: [JOIN] });

  await waitFor(() => ctx.arrived === 1, 'join reçu');
  ctx.authGate.open();
  await waitFor(() => onlineEntered, 'mise en ligne commencée');
  const serverClosed = new Promise(r => ctx.serverSocket.once('close', r));
  client.ws.terminate();
  await serverClosed;
  assert.equal(ctx.handle.sockets.has('u1'), true, 'le nettoyage attend la fin de la mise en ligne');
  onlineGate.open();

  // Sans ce point de passage, l'absence serait constatée avant le marquage.
  await waitFor(() => onlineDone, 'mise en ligne terminée');
  await waitFor(() => !ctx.handle.sockets.has('u1'), 'socket retiré');
  await waitFor(async () => !(await presenceStore.isOnline('u1')), 'hors ligne');
  assert.equal(ctx.ratingCalls, 0, 'le message du client parti n’est pas traité');
  assert.equal(await matchmakingStore.has('u1'), false);
});

test('déconnexion pendant le traitement de la file : pas de joueur fantôme en file', async (t) => {
  const ratingGate = gate();
  let ratingEntered = false;
  let joinDone = false;
  const realJoin = matchmakingStore.join;
  t.mock.method(matchmakingStore, 'join', async (ticket) => {
    await realJoin(ticket);
    joinDone = true;
  });
  const ctx = await startServer(t, {
    getRating: async () => { ratingEntered = true; await ratingGate.opened; return 1500; },
  });
  const client = connect(t, ctx, { messages: [JOIN] });

  await waitFor(() => ctx.arrived === 1, 'join reçu');
  ctx.authGate.open();
  await waitFor(() => ratingEntered, 'join en cours de traitement');
  const serverClosed = new Promise(r => ctx.serverSocket.once('close', r));
  client.ws.terminate();
  await serverClosed;
  assert.equal(ctx.handle.sockets.has('u1'), true, 'le nettoyage attend la fin du join');
  ratingGate.open();

  // Sans ce point de passage, l'absence serait constatée avant la mise en file.
  await waitFor(() => joinDone, 'join terminé');
  await waitFor(() => !ctx.handle.sockets.has('u1'), 'socket retiré');
  await waitFor(async () => !(await matchmakingStore.has('u1')), 'sorti de la file');
  assert.equal(await presenceStore.isOnline('u1'), false);
});

test('échec de la mise en ligne : fermeture 1011, messages jetés, serveur vivant', async (t) => {
  t.mock.method(presenceStore, 'addOnline', async () => { throw new Error('redis indisponible'); });
  const ctx = await startServer(t);
  const client = connect(t, ctx, { messages: [JOIN] });

  await waitFor(() => ctx.arrived === 1, 'join reçu');
  ctx.authGate.open();

  await waitFor(() => client.closeCode === 1011, 'fermeture 1011');
  await waitFor(() => !ctx.handle.sockets.has('u1'), 'socket retiré');
  assert.equal(ctx.ratingCalls, 0);
  assert.equal(await matchmakingStore.has('u1'), false);
});
