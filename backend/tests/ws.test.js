'use strict';

// Variables d'environnement requises par config.js, posées AVANT tout require
// (aucune connexion DB/SMTP n'est faite par le chemin WebSocket testé ici).
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
const { signToken } = require('../src/middleware/auth');

const c = (s, r) => ({ s, r });
const p = (hand) => ({ hand, won: [], declared: new Set(), annonce: 0 });
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const once = (em, ev) => new Promise(res => em.once(ev, res));

test('WebSocket : auth, état filtré par joueur, validation et diffusion des coups', async (t) => {
  registry.reset();
  const server = http.createServer();
  attachWebSocketServer(server);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  // Session déterministe : siège 0 doit jouer, phase draw (toute carte légale en entame).
  const session = registry.createSession({
    players: [{ userId: 'u1', name: 'Alice' }, { userId: 'u2', name: 'Bob' }],
    variant: 'classic', target: 3,
  });
  session.state = Object.assign({}, session.state, {
    turn: 0, trick: [], phase: 'draw', trump: 'pique', turnUp: null, talon: [],
    handOver: false,
    players: [p([c('coeur', 'R'), c('trefle', '8')]), p([c('coeur', '9'), c('carreau', '7')])],
  });

  const t1 = signToken({ id: 'u1', username: 'Alice' });
  const t2 = signToken({ id: 'u2', username: 'Bob' });
  const ws1 = new WebSocket(`ws://localhost:${port}/ws?token=${t1}`);
  const ws2 = new WebSocket(`ws://localhost:${port}/ws?token=${t2}`);
  const msgs1 = [], msgs2 = [];
  ws1.on('message', d => msgs1.push(JSON.parse(d.toString())));
  ws2.on('message', d => msgs2.push(JSON.parse(d.toString())));

  t.after(() => { ws1.close(); ws2.close(); server.close(); });

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
