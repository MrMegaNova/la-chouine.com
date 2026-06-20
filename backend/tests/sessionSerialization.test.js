'use strict';

// Sérialisation de GameSession pour Redis (#31) : l'état partagé entre instances
// transite en JSON. Ces tests garantissent qu'un aller-retour toJSON/fromJSON ne
// perd rien — en particulier les Set (nextHandAcks, players[].declared), qui
// JSON.stringify aplatirait silencieusement. Tests purs : aucune DB, aucun Redis.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GameSession } = require('../src/game/session');
const turnClock = require('../src/game/turnClock');

function newSession() {
  return new GameSession({
    id: 's1',
    players: [{ userId: 'u1', name: 'Alice' }, { userId: 'u2', name: 'Bob' }],
    variant: 'classic', target: 3, rated: true,
  });
}

const roundTrip = (s) => GameSession.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));

test('round-trip : snapshot identique à l’état initial', () => {
  const s = newSession();
  const back = roundTrip(s);
  assert.deepEqual(back.snapshotFor('u1'), s.snapshotFor('u1'));
  assert.deepEqual(back.snapshotFor('u2'), s.snapshotFor('u2'));
});

test('round-trip : les Set declared et nextHandAcks sont restaurés en Set', () => {
  const s = newSession();
  s.state.players[0].declared.add('mariage-coeur');
  s.nextHandAcks.add(1);
  const back = roundTrip(s);
  assert.ok(back.state.players[0].declared instanceof Set, 'declared doit rester un Set');
  assert.ok(back.state.players[0].declared.has('mariage-coeur'));
  assert.ok(back.nextHandAcks instanceof Set, 'nextHandAcks doit rester un Set');
  assert.ok(back.nextHandAcks.has(1));
});

test('round-trip : après un coup joué, l’état est préservé et reste jouable', () => {
  const s = newSession();
  // Coupe interactive (#201) : les deux sièges piochent (→ révélation), puis la
  // révélation se clôt et distribue la 1ʳᵉ main.
  assert.ok(s.applyAction('u1', { type: 'cut' }).ok);
  assert.ok(s.applyAction('u2', { type: 'cut' }).ok);
  assert.equal(s.state.phase, 'cutReveal');
  assert.ok(s.finishReveal().ok, 'la révélation distribue la 1ʳᵉ main');
  assert.equal(s.state.phase, 'draw');

  const seat = s.state.turn;
  const snap = s.snapshotFor(s.players[seat].userId);
  const res = s.applyAction(s.players[seat].userId, { type: 'play', card: snap.players[seat].legalMoves[0] });
  assert.ok(res.ok, 'le coup initial doit être légal');

  const back = roundTrip(s);
  assert.deepEqual(back.snapshotFor('u1'), s.snapshotFor('u1'));
  assert.deepEqual(back.snapshotFor('u2'), s.snapshotFor('u2'));

  // La session rechargée doit accepter le coup suivant comme la session d'origine.
  const seat2 = back.state.turn;
  const u2 = back.players[seat2].userId;
  const snap2 = back.snapshotFor(u2);
  assert.ok(back.applyAction(u2, { type: 'play', card: snap2.players[seat2].legalMoves[0] }).ok);
});

test('round-trip : horloge de coup (#141) préservée', () => {
  const s = newSession();
  turnClock.startTurn(s.clock, s.state.turn, 1000);
  const back = roundTrip(s);
  assert.deepEqual(back.clock, s.clock);
  assert.equal(back.clockView(2000).remainingMs, s.clockView(2000).remainingMs);
});

test('round-trip : partie amicale (clock null) préservée', () => {
  const s = new GameSession({
    id: 's2', players: [{ userId: 'u1', name: 'A' }, { userId: 'u2', name: 'B' }],
    variant: 'mondoubleau', target: 3, rated: false,
  });
  const back = roundTrip(s);
  assert.equal(back.clock, null);
  assert.equal(back.rated, false);
  assert.equal(back.variant, 'mondoubleau');
  assert.deepEqual(back.snapshotFor('u1'), s.snapshotFor('u1'));
});
