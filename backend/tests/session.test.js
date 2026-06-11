'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { GameSession } = require('../src/game/session');

const c = (s, r) => ({ s, r });
const p = (hand, won = [], annonce = 0) => ({ hand, won, declared: new Set(), annonce });

function mkSession(overrides = {}) {
  const sess = new GameSession({
    id: 't', variant: 'classic', target: 3,
    players: [{ userId: 'u1', name: 'Alice' }, { userId: 'u2', name: 'Bob' }],
  });
  sess.state = Object.assign({}, sess.state, {
    turn: 0, trick: [], phase: 'final', trump: 'pique', turnUp: null, talon: [],
    handOver: false, scores: [0, 0],
  }, overrides);
  return sess;
}

test('snapshotFor : main du joueur visible, main adverse masquée (décompte seulement)', () => {
  const sess = mkSession({
    players: [p([c('pique', 'A'), c('coeur', '7')]), p([c('pique', 'R')])],
  });
  const snap = sess.snapshotFor('u1'); // siège 0
  assert.equal(snap.you, 0);
  assert.deepEqual(snap.players[0].hand, [c('pique', 'A'), c('coeur', '7')]);
  assert.equal(snap.players[1].hand, undefined);
  assert.equal(snap.players[1].handCount, 1);
  assert.ok(Array.isArray(snap.players[0].legalMoves)); // à lui de jouer
});

test('applyAction : refuse un coup hors-tour', () => {
  const sess = mkSession({ players: [p([c('pique', 'A')]), p([c('pique', 'R')])] });
  const res = sess.applyAction('u2', { type: 'play', card: c('pique', 'R') });
  assert.equal(res.ok, false);
});

test('applyAction : refuse un coup illégal (ne suit pas la couleur en phase finale)', () => {
  const sess = mkSession({
    trump: 'carreau', turn: 0, trick: [{ p: 1, card: c('coeur', '9') }],
    players: [p([c('coeur', '7'), c('pique', 'A')]), p([])],
  });
  assert.equal(sess.applyAction('u1', { type: 'play', card: c('pique', 'A') }).ok, false);
});

test('play : un pli complet est résolu de façon autoritaire', () => {
  const sess = mkSession({
    trump: 'pique', turn: 0, trick: [{ p: 1, card: c('coeur', '9') }],
    players: [p([c('coeur', 'R'), c('trefle', '8')]), p([c('carreau', '7')])],
  });
  const res = sess.applyAction('u1', { type: 'play', card: c('coeur', 'R') });
  assert.ok(res.ok);
  assert.equal(sess.state.trick.length, 0);  // pli résolu et vidé
  assert.equal(sess.lastTrick.winner, 0);    // R bat 9
  assert.equal(sess.state.turn, 0);          // le gagnant entame
  assert.equal(sess.state.players[0].won.length, 2);
});

test('declare : un mariage ajoute la valeur d’annonce', () => {
  const sess = mkSession({
    phase: 'draw', trump: 'coeur', turn: 0,
    players: [p([c('pique', 'R'), c('pique', 'D')]), p([])],
  });
  const res = sess.applyAction('u1', { type: 'declare', sig: 'mariage|pique' });
  assert.ok(res.ok);
  assert.equal(sess.state.players[0].annonce, 20);
});

test('nextHand : nécessite l’accord des deux joueurs avant de distribuer', () => {
  const sess = mkSession({ handOver: true });
  assert.ok(sess.applyAction('u1', { type: 'nextHand' }).ok);
  assert.equal(sess.state.handOver, true);   // un seul accord → on attend
  assert.ok(sess.applyAction('u2', { type: 'nextHand' }).ok);
  assert.equal(sess.state.handOver, false);  // les deux → nouvelle main
});

test('chouine gagnante qui atteint l’objectif → match terminé + outcome', () => {
  const sess = mkSession({
    phase: 'draw', trump: 'coeur', turn: 0, scores: [2, 0],
    players: [
      p([c('pique', 'A'), c('pique', '10'), c('pique', 'R'), c('pique', 'D'), c('pique', 'V')]),
      p([c('coeur', '7'), c('coeur', '8'), c('coeur', '9'), c('carreau', '7'), c('carreau', '8')]),
    ],
  });
  const res = sess.applyAction('u1', { type: 'declare', sig: 'chouine|pique' });
  assert.ok(res.ok);
  assert.equal(sess.finished, true);
  const outcome = sess.getMatchOutcome();
  assert.equal(outcome.variant, 'classic');
  assert.equal(outcome.players.find(x => x.userId === 'u1').won, true);
  assert.equal(outcome.players.find(x => x.userId === 'u2').won, false);
  assert.equal(outcome.players.find(x => x.userId === 'u1').score, 3);
});

test('forfeit : l’adversaire gagne, défaite Elo pleine pour l’abandonnant', () => {
  const sess = mkSession({ scores: [1, 0] });
  const res = sess.applyAction('u1', { type: 'forfeit' });
  assert.ok(res.ok);
  assert.equal(sess.finished, true);
  assert.deepEqual(sess.matchResult.forfeit, { by: 0, reason: 'abandon' });

  const outcome = sess.getMatchOutcome();
  assert.equal(outcome.players.find(x => x.userId === 'u1').won, false);
  assert.equal(outcome.players.find(x => x.userId === 'u2').won, true);

  // L'issue par forfait est visible dans le snapshot des deux joueurs.
  assert.equal(sess.snapshotFor('u2').matchResult.forfeit.by, 0);
});

test('forfeit : refusé si la partie est déjà terminée ; aucun coup après forfait', () => {
  const sess = mkSession({ players: [p([c('pique', 'A')]), p([c('pique', 'R')])] });
  assert.ok(sess.forfeit(1, 'timeout').ok);
  assert.deepEqual(sess.matchResult.forfeit, { by: 1, reason: 'timeout' });
  assert.equal(sess.forfeit(0).ok, false);
  assert.equal(sess.applyAction('u1', { type: 'play', card: c('pique', 'A') }).ok, false);
});

test('snapshotFor : ne fournit pas les coups légaux au joueur dont ce n’est pas le tour', () => {
  const sess = mkSession({
    turn: 0, players: [p([c('pique', 'A')]), p([c('pique', 'R')])],
  });
  const snapOpp = sess.snapshotFor('u2'); // siège 1, pas son tour
  assert.equal(snapOpp.players[1].legalMoves, undefined);
});
