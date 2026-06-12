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

test('declare (#77) : l’annonce se valide en jouant une carte qui la compose', () => {
  const sess = mkSession({
    phase: 'draw', trump: 'coeur', turn: 0,
    players: [p([c('pique', 'R'), c('pique', 'D'), c('trefle', '7')]), p([c('coeur', '8')])],
  });

  // (1) Sans carte : refusée.
  assert.equal(sess.applyAction('u1', { type: 'declare', sig: 'mariage|pique' }).ok, false);
  // (2) Avec une carte étrangère à l'annonce : refusée.
  assert.equal(sess.applyAction('u1', { type: 'declare', sig: 'mariage|pique', card: c('trefle', '7') }).ok, false);
  assert.equal(sess.state.players[0].annonce, 0, 'rien n’a été crédité');

  // (3) Avec une carte de l'annonce : créditée ET la carte est jouée.
  const res = sess.applyAction('u1', { type: 'declare', sig: 'mariage|pique', card: c('pique', 'D') });
  assert.ok(res.ok);
  assert.equal(sess.state.players[0].annonce, 20);
  assert.deepEqual(sess.state.trick, [{ p: 0, card: c('pique', 'D') }], 'la carte accompagne l’annonce');
  assert.equal(sess.state.players[0].hand.length, 2, 'la carte a quitté la main');

  // (4) Les cartes de l'annonce sont étalées : visibles des deux joueurs.
  const snapOpp = sess.snapshotFor('u2');
  assert.deepEqual(snapOpp.lastAnnounce, {
    seat: 0, sig: 'mariage|pique', label: 'Mariage ♠',
    cards: [c('pique', 'R'), c('pique', 'D')],
  });
});

test('declare (#90) : l’annonce est permise en réponse (phase de pioche)', () => {
  // Bob a entamé ; Alice répond et annonce sa quinte (5 brisques en main).
  const sess = mkSession({
    phase: 'draw', trump: 'coeur', turn: 0, leader: 1,
    trick: [{ p: 1, card: c('coeur', 'R') }],
    players: [
      p([c('pique', 'A'), c('pique', '10'), c('carreau', 'A'), c('carreau', '10'), c('trefle', '10')]),
      p([c('coeur', '8'), c('coeur', '9'), c('trefle', '7'), c('trefle', '8')]),
    ],
  });
  const res = sess.applyAction('u1', { type: 'declare', sig: 'quinte', card: c('trefle', '10') });
  assert.ok(res.ok, res.error);
  assert.equal(sess.state.players[0].annonce, 50, 'la quinte est créditée');
  assert.equal(sess.lastTrick.cards.length, 2, 'la carte a complété le pli');
});

test('declare (#90) : refusée en réponse de phase finale si la carte de l’annonce est illégale', () => {
  // Phase finale, Bob entame coeur : Alice a du coeur, elle doit fournir —
  // la D♠ de son mariage n’est pas un coup légal, l’annonce est refusée
  // sans rien créditer (rollback).
  const sess = mkSession({
    phase: 'final', trump: 'carreau', turn: 0,
    trick: [{ p: 1, card: c('coeur', '9') }],
    players: [
      p([c('coeur', '7'), c('pique', 'R'), c('pique', 'D')]),
      p([c('trefle', '7'), c('trefle', '8')]),
    ],
  });
  const res = sess.applyAction('u1', { type: 'declare', sig: 'mariage|pique', card: c('pique', 'D') });
  assert.equal(res.ok, false);
  assert.equal(sess.state.players[0].annonce, 0, 'rien n’a été crédité (rollback)');
  assert.equal(sess.state.players[0].hand.length, 3, 'la carte n’a pas quitté la main');
});

test('declare (#90) : la chouine reste réservée à l’entame', () => {
  const sess = mkSession({
    phase: 'draw', trump: 'coeur', turn: 0,
    trick: [{ p: 1, card: c('coeur', '8') }],
    players: [
      p([c('pique', 'A'), c('pique', '10'), c('pique', 'R'), c('pique', 'D'), c('pique', 'V')]),
      p([c('coeur', '7'), c('coeur', '9'), c('carreau', '7'), c('carreau', '8')]),
    ],
  });
  assert.equal(sess.applyAction('u1', { type: 'declare', sig: 'chouine|pique' }).ok, false);
  assert.equal(sess.finished, false);
});

test('exchangeSeven (#76) : l’échange du 7 d’atout est permis en réponse à un pli', () => {
  // Bob a entamé ; Alice, qui détient le 7 d'atout, l'échange contre la
  // retourne avant de répondre.
  const sess = mkSession({
    phase: 'draw', trump: 'coeur', turnUp: c('coeur', 'D'), turn: 0,
    talon: [c('trefle', '9')],
    trick: [{ p: 1, card: c('pique', '8') }],
    players: [
      p([c('coeur', '7'), c('carreau', 'A')]),
      p([c('trefle', '7')]),
    ],
  });
  const res = sess.applyAction('u1', { type: 'exchangeSeven' });
  assert.ok(res.ok, res.error);
  assert.deepEqual(sess.state.turnUp, c('coeur', '7'), 'le 7 devient la retourne');
  assert.ok(sess.state.players[0].hand.some(x => x.s === 'coeur' && x.r === 'D'), 'la Dame est en main');
  assert.deepEqual(sess.state.trick, [{ p: 1, card: c('pique', '8') }], 'le pli en cours est intact');

  // L'échange est signalé aux DEUX joueurs via le snapshot (#76).
  assert.deepEqual(sess.snapshotFor('u1').lastExchange, { seat: 0, handNo: sess.state.handNo });
  assert.deepEqual(sess.snapshotFor('u2').lastExchange, { seat: 0, handNo: sess.state.handNo });
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

test('snapshotFor : ses propres plis visibles, ceux de l’adversaire en décompte seul (#74)', () => {
  const sess = mkSession({
    players: [
      p([c('pique', 'A')], [c('coeur', 'A'), c('coeur', '9')]),
      p([c('pique', 'R')], [c('trefle', '7'), c('trefle', '8')]),
    ],
  });
  const snap = sess.snapshotFor('u1');
  assert.deepEqual(snap.players[0].won, [c('coeur', 'A'), c('coeur', '9')], 'sa pile est consultable');
  assert.equal(snap.players[1].won, undefined, 'la pile adverse reste masquée');
  assert.equal(snap.players[1].wonCount, 2, 'seul le décompte adverse est public');
});

test('snapshotFor (#95) : expose le dernier pli ramassé par l’adversaire, même après un pli à soi', () => {
  const sess = mkSession({
    trump: 'pique', turn: 1,
    players: [
      p([c('coeur', 'R'), c('trefle', '8')]),
      p([c('coeur', '9'), c('carreau', '7'), c('carreau', '8')]),
    ],
  });
  // Pli 1 : Bob (siège 1) entame et le remporte.
  assert.ok(sess.applyAction('u2', { type: 'play', card: c('carreau', '8') }).ok);
  assert.ok(sess.applyAction('u1', { type: 'play', card: c('trefle', '8') }).ok);
  assert.equal(sess.lastTrick.winner, 1);
  // Pli 2 : Alice remporte le sien — lastTrick global devient le sien.
  assert.ok(sess.applyAction('u2', { type: 'play', card: c('coeur', '9') }).ok);
  assert.ok(sess.applyAction('u1', { type: 'play', card: c('coeur', 'R') }).ok);
  assert.equal(sess.lastTrick.winner, 0);

  // Alice voit toujours le dernier pli de Bob (pli 1), pas le sien.
  const snapAlice = sess.snapshotFor('u1');
  assert.equal(snapAlice.opponentLastTrick.winner, 1);
  assert.deepEqual(snapAlice.opponentLastTrick.cards.map(t => t.card),
    [c('carreau', '8'), c('trefle', '8')]);
  // Bob voit le dernier pli d'Alice (pli 2).
  const snapBob = sess.snapshotFor('u2');
  assert.equal(snapBob.opponentLastTrick.winner, 0);
});

test('snapshotFor : ne fournit pas les coups légaux au joueur dont ce n’est pas le tour', () => {
  const sess = mkSession({
    turn: 0, players: [p([c('pique', 'A')]), p([c('pique', 'R')])],
  });
  const snapOpp = sess.snapshotFor('u2'); // siège 1, pas son tour
  assert.equal(snapOpp.players[1].legalMoves, undefined);
});
