'use strict';

// Variables d'environnement requises par config.js, posées AVANT tout require
// (aucune connexion DB/SMTP n'est faite par le chemin WebSocket testé ici).
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

const c = (s, r) => ({ s, r });
const p = (hand) => ({ hand, won: [], declared: new Set(), annonce: 0 });
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const once = (em, ev) => new Promise(res => em.once(ev, res));

beforeEach(async () => { const r = useMockRedis(7); await flush(r); await bus.stop(); });
after(closeRedis);

test('WebSocket : auth, état filtré par joueur, validation et diffusion des coups', async (t) => {
  const server = http.createServer();
  const handle = await attachWebSocketServer(server);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  // Session déterministe : siège 0 doit jouer, phase draw (toute carte légale en entame).
  const session = await sessionStore.createSession({
    players: [{ userId: 'u1', name: 'Alice' }, { userId: 'u2', name: 'Bob' }],
    variant: 'classic', target: 3,
  });
  session.state = Object.assign({}, session.state, {
    turn: 0, trick: [], phase: 'draw', trump: 'pique', turnUp: null, talon: [],
    handOver: false,
    players: [p([c('coeur', 'R'), c('trefle', '8')]), p([c('coeur', '9'), c('carreau', '7')])],
  });
  await sessionStore.save(session);

  const t1 = signToken({ id: 'u1', username: 'Alice' });
  const t2 = signToken({ id: 'u2', username: 'Bob' });
  const ws1 = new WebSocket(`ws://localhost:${port}/ws?token=${t1}`);
  const ws2 = new WebSocket(`ws://localhost:${port}/ws?token=${t2}`);
  const msgs1 = [], msgs2 = [];
  ws1.on('message', d => msgs1.push(JSON.parse(d.toString())));
  ws2.on('message', d => msgs2.push(JSON.parse(d.toString())));

  t.after(async () => { ws1.close(); ws2.close(); handle.stop(); server.close(); });

  await Promise.all([once(ws1, 'open'), once(ws2, 'open')]);
  await delay(60);

  // (1) À la connexion, chacun reçoit son état filtré : sa main visible, l'adverse masquée.
  const state1 = msgs1.filter(m => m.t === 'state').pop();
  assert.ok(state1, 'le joueur 1 doit recevoir un état');
  assert.equal(state1.state.you, 0);
  assert.ok(state1.state.players[0].hand, 'sa propre main est visible');
  assert.equal(state1.state.players[1].hand, undefined, 'la main adverse est masquée');
  assert.equal(state1.state.players[1].handCount, 2);

  // (2) Connexion sans token valide → rejetée (code 4001).
  const wsBad = new WebSocket(`ws://localhost:${port}/ws?token=invalid`);
  const closeCode = await new Promise(res => wsBad.on('close', code => res(code)));
  assert.equal(closeCode, 4001);

  // (3) Coup hors-tour (joueur 2) → erreur, état inchangé.
  msgs2.length = 0;
  ws2.send(JSON.stringify({ t: 'action', action: { type: 'play', card: c('coeur', '9') } }));
  await delay(60);
  assert.ok(msgs2.some(m => m.t === 'error'), 'un coup hors-tour est refusé');

  // (4) Coup légal du joueur 1 → diffusé aux DEUX joueurs ; le tour passe au joueur 2.
  msgs1.length = 0; msgs2.length = 0;
  ws1.send(JSON.stringify({ t: 'action', action: { type: 'play', card: c('coeur', 'R') } }));
  await delay(60);
  const after2 = msgs2.filter(m => m.t === 'state').pop();
  assert.ok(after2, 'le joueur 2 reçoit l’état mis à jour (diffusion)');
  assert.equal(after2.state.trick.length, 1, 'la carte jouée est dans le pli');
  assert.equal(after2.state.turn, 1, 'c’est maintenant au joueur 2');
  assert.ok(after2.state.players[1].hand, 'le joueur 2 voit toujours sa propre main');
});

test('WebSocket : validateUser rejette un token révoqué (#117)', async (t) => {
  const server = http.createServer();
  // En production, validateUser compare la version embarquée dans le JWT à
  // celle du compte (token_version). Ici : tout token de version 0 est révoqué.
  const handle = await attachWebSocketServer(server, { validateUser: async (u) => (u.ver ?? 0) >= 1 });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  t.after(() => { handle.stop(); server.close(); });

  // Token « ancien » (ver 0 par défaut) → refusé comme une signature invalide.
  const oldToken = signToken({ id: 'u1', username: 'Alice' });
  const wsOld = new WebSocket(`ws://localhost:${port}/ws?token=${oldToken}`);
  const closeCode = await new Promise(res => wsOld.on('close', code => res(code)));
  assert.equal(closeCode, 4001, 'token révoqué → connexion refusée');

  // Token « frais » (ver 1) → accepté.
  const freshToken = signToken({ id: 'u1', username: 'Alice', token_version: 1 });
  const wsFresh = new WebSocket(`ws://localhost:${port}/ws?token=${freshToken}`);
  const msgs = [];
  wsFresh.on('message', d => msgs.push(JSON.parse(d.toString())));
  await once(wsFresh, 'open');
  await delay(60);
  assert.ok(msgs.some(m => m.t === 'hello'), 'token à jour → connexion acceptée');
  wsFresh.close();
});

test('WebSocket : rate-limit des messages — flood rejeté puis connexion fermée (#124)', async (t) => {
  const server = http.createServer();
  // Budget volontairement petit pour un test rapide et déterministe.
  const handle = await attachWebSocketServer(server, { msgRatePerSec: 5, msgBurst: 5, msgFloodKick: 10 });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  t.after(() => { handle.stop(); server.close(); });

  const token = signToken({ id: 'uflood', username: 'Flood' });
  const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
  const msgs = [];
  let closeCode = null;
  ws.on('message', d => msgs.push(JSON.parse(d.toString())));
  ws.on('close', code => { closeCode = code; });
  await once(ws, 'open');
  await delay(20);

  // Rafale bien au-delà du budget (burst 5 + 10 rejets consécutifs → kick).
  for (let i = 0; i < 60; i++) ws.send(JSON.stringify({ t: 'sync' }));
  await delay(120);

  assert.ok(msgs.some(m => m.t === 'error' && m.code === 'RATE_LIMIT'), 'le flood est rejeté');
  assert.equal(closeCode, 4002, 'un flood soutenu ferme la connexion');
});

test('WebSocket : le jeu normal n’est jamais rate-limité (#124)', async (t) => {
  const server = http.createServer();
  const handle = await attachWebSocketServer(server);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  t.after(() => { handle.stop(); server.close(); });

  const token = signToken({ id: 'ucalm', username: 'Calm' });
  const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
  const msgs = [];
  ws.on('message', d => msgs.push(JSON.parse(d.toString())));
  await once(ws, 'open');
  await delay(20);

  // Quelques sync espacés (rythme d'une partie réelle) — aucun rejet.
  for (let i = 0; i < 5; i++) { ws.send(JSON.stringify({ t: 'sync' })); await delay(20); }
  await delay(40);
  assert.ok(!msgs.some(m => m.code === 'RATE_LIMIT'), 'aucun message légitime n’est throttlé');
  ws.close();
});
