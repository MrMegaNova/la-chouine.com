'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const E = require('../src/game/engine');

// ─── Helpers de construction d'états déterministes ────────────────────────────

const c = (s, r) => ({ s, r });
const makeP = (hand, won = [], annonce = 0) => ({ hand, won, declared: new Set(), annonce });

function g(overrides) {
  return Object.assign({
    playerCount: 2, variant: 'classic', mode: 'online', trump: null,
    players: [makeP([]), makeP([])], trick: [], phase: 'draw',
    talon: [], turnUp: null, leader: 0, turn: 0, lastTrickWinner: null,
    scores: [0, 0], target: 3, sevenAnnounced: false, names: ['A', 'B'],
  }, overrides);
}

// ─── Deck & distribution ──────────────────────────────────────────────────────

test('buildDeck : 32 cartes uniques', () => {
  const deck = E.buildDeck();
  assert.equal(deck.length, 32);
  const sigs = new Set(deck.map(x => `${x.s}-${x.r}`));
  assert.equal(sigs.size, 32);
});

test('dealHand 2 joueurs (classique) : 5 cartes chacun, atout = retourne, total conservé', () => {
  const base = E.createGame({ mode: 'online', variant: 'classic', playerCount: 2, target: 3, names: ['A', 'B'] });
  const d = E.dealHand(base);
  assert.equal(d.players[0].hand.length, 5);
  assert.equal(d.players[1].hand.length, 5);
  assert.ok(d.turnUp);
  assert.equal(d.trump, d.turnUp.s);
  assert.equal(d.talon.length, 21); // 32 - 10 - 1
  assert.equal(d.phase, 'draw');
  assert.equal(10 + d.talon.length + 1, 32);
});

test('dealHand mondoubleau : pas d’atout ni de retourne, talon de 22', () => {
  const base = E.createGame({ mode: 'online', variant: 'mondoubleau', playerCount: 2, target: 3, names: ['A', 'B'] });
  const d = E.dealHand(base);
  assert.equal(d.trump, null);
  assert.equal(d.turnUp, null);
  assert.equal(d.talon.length, 22); // 32 - 10
});

test('drawForDealer : la plus petite carte tirée désigne le donneur', () => {
  const ORDER = { '7': 0, '8': 1, '9': 2, V: 3, D: 4, R: 5, 10: 6, A: 7 };
  const SUIT_RANK = { pique: 0, coeur: 1, carreau: 2, trefle: 3 };
  const less = (a, b) =>
    ORDER[a.r] < ORDER[b.r] || (ORDER[a.r] === ORDER[b.r] && SUIT_RANK[a.s] < SUIT_RANK[b.s]);

  for (let n = 2; n <= 4; n++) {
    for (let it = 0; it < 200; it++) {
      const { dealer, draws } = E.drawForDealer(n);
      assert.equal(draws.length, n);
      assert.equal(new Set(draws.map(c => `${c.s}|${c.r}`)).size, n);
      assert.ok(dealer >= 0 && dealer < n);
      for (let i = 0; i < n; i++) {
        if (i !== dealer) assert.equal(less(draws[i], draws[dealer]), false);
      }
    }
  }
});

test('drawCut : tire siège par siège puis distribue au dernier (donneur = plus petite)', () => {
  const ORDER = { '7': 0, '8': 1, '9': 2, V: 3, D: 4, R: 5, 10: 6, A: 7 };
  const SUIT_RANK = { pique: 0, coeur: 1, carreau: 2, trefle: 3 };
  const less = (a, b) =>
    ORDER[a.r] < ORDER[b.r] || (ORDER[a.r] === ORDER[b.r] && SUIT_RANK[a.s] < SUIT_RANK[b.s]);

  let g = E.createGame({ mode: 'online', variant: 'classic', playerCount: 2, target: 3, names: ['A', 'B'] });
  assert.equal(g.phase, 'cut');

  const picks = [];
  picks[0] = g.cut.deck[g.cut.deck.length - 1];
  g = E.drawCut(g, 0);
  assert.equal(g.phase, 'cut'); // il reste un siège à servir
  assert.deepEqual(g.cut.picks[0], picks[0]);

  picks[1] = g.cut.deck[g.cut.deck.length - 1];
  g = E.drawCut(g, 1);
  assert.equal(g.phase, 'draw'); // dernier tirage → 1ʳᵉ main distribuée
  assert.equal(g.handNo, 1);
  const expected = less(picks[0], picks[1]) ? 0 : 1;
  assert.equal(g.dealer, expected);
});

test('drawCut : gardes — hors phase, siège hors bornes, siège déjà servi, paquet vide → état inchangé', () => {
  const base = E.createGame({ mode: 'online', variant: 'classic', playerCount: 2, target: 3, names: ['A', 'B'] });

  // Hors phase cut (partie déjà distribuée).
  const dealt = E.dealHand(E.createGame({ mode: 'online', variant: 'classic', playerCount: 2, target: 3, names: ['A', 'B'] }));
  assert.equal(E.drawCut(dealt, 0), dealt);

  // Siège hors bornes.
  assert.equal(E.drawCut(base, -1), base);
  assert.equal(E.drawCut(base, 2), base);

  // Siège déjà servi.
  const once = E.drawCut(base, 0);
  assert.equal(E.drawCut(once, 0), once);

  // Paquet de coupe vide (filet de sécurité).
  const empty = { ...base, cut: { deck: [], picks: [null, null] } };
  assert.equal(E.drawCut(empty, 0), empty);
});

// ─── Comparaison / résolution de pli ──────────────────────────────────────────

test('cardBeats : l’atout bat une non-atout, la plus haute de même couleur gagne', () => {
  assert.equal(E.cardBeats(c('coeur', 'A'), c('pique', '7'), 'pique'), true);  // atout coupe
  assert.equal(E.cardBeats(c('pique', '7'), c('coeur', 'A'), 'pique'), false); // non-atout ne bat pas l'atout
  assert.equal(E.cardBeats(c('coeur', '9'), c('coeur', 'R'), null), true);     // R > 9 même couleur
  assert.equal(E.cardBeats(c('coeur', '9'), c('pique', 'A'), null), false);    // couleur différente, pas d'atout
});

test('resolveTrickWinner : désigne le bon siège', () => {
  const trick = [{ p: 0, card: c('pique', 'A') }, { p: 1, card: c('pique', 'R') }];
  assert.equal(E.resolveTrickWinner(trick, 'carreau'), 0); // A > R
});

// ─── Coups légaux ─────────────────────────────────────────────────────────────

test('getLegalMoves : phase draw → toute la main est jouable', () => {
  const game = g({ trick: [{ p: 0, card: c('pique', '9') }], phase: 'draw',
    players: [makeP([]), makeP([c('coeur', '7'), c('trefle', 'A')])], turn: 1 });
  assert.equal(E.getLegalMoves(game, 1).length, 2);
});

test('getLegalMoves : phase final → obligation de fournir la couleur demandée', () => {
  const game = g({ phase: 'final', trump: 'carreau', trick: [{ p: 0, card: c('pique', '9') }],
    players: [makeP([]), makeP([c('pique', '7'), c('pique', 'R'), c('coeur', 'A')])], turn: 1 });
  const legal = E.getLegalMoves(game, 1);
  assert.equal(legal.length, 2);
  assert.ok(legal.every(x => x.s === 'pique'));
});

test('getLegalMoves : phase final, atout demandé → obligation de monter', () => {
  const game = g({ phase: 'final', trump: 'pique', trick: [{ p: 0, card: c('pique', '9') }],
    players: [makeP([]), makeP([c('pique', '7'), c('pique', 'R'), c('coeur', 'A')])], turn: 1 });
  const legal = E.getLegalMoves(game, 1);
  assert.deepEqual(legal, [c('pique', 'R')]); // seule plus haute que le 9
});

test('getLegalMoves : phase final, ne peut pas fournir → obligation de couper', () => {
  const game = g({ phase: 'final', trump: 'pique', trick: [{ p: 0, card: c('coeur', '9') }],
    players: [makeP([]), makeP([c('pique', '7'), c('trefle', 'A')])], turn: 1 });
  assert.deepEqual(E.getLegalMoves(game, 1), [c('pique', '7')]);
});

// ─── Application des coups ────────────────────────────────────────────────────

test('applyPlayCard : pose la carte (par valeur) et passe la main', () => {
  const game = g({ players: [makeP([c('pique', 'A'), c('coeur', '7')]), makeP([])], turn: 0 });
  const after = E.applyPlayCard(game, 0, c('pique', 'A'));
  assert.equal(after.trick.length, 1);
  assert.equal(after.turn, 1);
  assert.deepEqual(after.players[0].hand, [c('coeur', '7')]);
});

test('applyPlayCard : carte qui complète le pli → le tour N’est PAS avancé', () => {
  const game = g({ players: [makeP([]), makeP([c('pique', 'R')])],
    trick: [{ p: 0, card: c('pique', 'A') }], turn: 1 });
  const after = E.applyPlayCard(game, 1, c('pique', 'R'));
  assert.equal(after.trick.length, 2);
  assert.equal(after.turn, 1);
});

test('applyPlayCard : régression #21 — refuse d’ajouter à un pli déjà complet', () => {
  const game = g({ playerCount: 2,
    trick: [{ p: 0, card: c('pique', 'A') }, { p: 1, card: c('pique', 'R') }],
    players: [makeP([c('coeur', '7')]), makeP([c('coeur', '8')])], turn: 1 });
  const after = E.applyPlayCard(game, 1, c('coeur', '8'));
  assert.equal(after, game);            // état inchangé (même référence)
  assert.equal(after.trick.length, 2);  // pas de 3e carte
});

test('applyResolveTrick (draw) : gagnant ramasse, pli vidé, pioche, passage en final', () => {
  const game = g({ trump: 'pique',
    trick: [{ p: 0, card: c('pique', 'A') }, { p: 1, card: c('pique', 'R') }],
    players: [makeP([]), makeP([])],
    talon: [c('coeur', '7'), c('coeur', '8')], turnUp: c('pique', '9'), phase: 'draw' });
  const after = E.applyResolveTrick(game);
  assert.equal(after.lastTrickWinner, 0);
  assert.equal(after.trick.length, 0);
  assert.equal(after.players[0].won.length, 2);
  assert.equal(after.players[0].hand.length, 1); // a pioché
  assert.equal(after.players[1].hand.length, 1);
  assert.equal(after.talon.length, 0);
  assert.equal(after.phase, 'final'); // reste 1 carte (< 2 joueurs)
});

// ─── Annonces ─────────────────────────────────────────────────────────────────

test('getAvailableCombos (2j) : mariage détecté, doublé si atout', () => {
  const game = g({ trump: 'coeur', players: [makeP([c('pique', 'R'), c('pique', 'D')]), makeP([])] });
  const combos = E.getAvailableCombos(game, 0);
  assert.ok(combos.some(k => k.type === 'mariage' && k.suit === 'pique' && k.value === 20));

  const gameTrump = g({ trump: 'pique', players: [makeP([c('pique', 'R'), c('pique', 'D')]), makeP([])] });
  const combosT = E.getAvailableCombos(gameTrump, 0);
  assert.ok(combosT.some(k => k.type === 'mariage' && k.value === 40)); // doublé
});

test('getAvailableCombos (2j) : tierce et quarteron', () => {
  const tierce = g({ trump: 'coeur', players: [makeP([c('pique', 'R'), c('pique', 'D'), c('pique', 'V')]), makeP([])] });
  assert.ok(E.getAvailableCombos(tierce, 0).some(k => k.type === 'tierce' && k.value === 30));

  const quart = g({ trump: 'coeur', players: [makeP([c('pique', 'A'), c('pique', 'R'), c('pique', 'D'), c('pique', 'V')]), makeP([])] });
  assert.ok(E.getAvailableCombos(quart, 0).some(k => k.type === 'quarteron' && k.value === 40));
});

// ─── Fin de main ──────────────────────────────────────────────────────────────

test('computeHandResult : points + annonce + bonus du dernier pli (der +10)', () => {
  const game = g({
    players: [makeP([], [c('pique', 'A'), c('pique', '10')], 20), makeP([], [c('coeur', 'R')], 0)],
    lastTrickWinner: 0, scores: [0, 0], target: 3,
  });
  const r = E.computeHandResult(game);
  assert.equal(r.tot[0], 51); // 11 + 10 + 20 (annonce) + 10 (der)
  assert.equal(r.tot[1], 4);
  assert.equal(r.winner, 0);
  assert.equal(r.matchWinner, null);
});

test('computeHandResult : matchWinner quand l’objectif est atteint', () => {
  const game = g({
    players: [makeP([], [c('pique', 'A')], 0), makeP([], [], 0)],
    lastTrickWinner: 0, scores: [2, 0], target: 3,
  });
  const r = E.computeHandResult(game);
  assert.equal(r.winner, 0);
  assert.equal(r.matchWinner, 0); // 2 + 1 = 3
});

test('computeHandResult : égalité parfaite → pas de gagnant (-1)', () => {
  const game = g({
    players: [makeP([], [c('pique', 'A')], 0), makeP([], [c('coeur', 'A')], 0)],
    lastTrickWinner: null, scores: [0, 0], target: 3,
  });
  const r = E.computeHandResult(game);
  assert.equal(r.winner, -1);
});

// ─── « Au sept » ──────────────────────────────────────────────────────────────

test('shouldAnnounceAuSept : vrai si 7 d’atout en main et talon presque épuisé', () => {
  const game = g({ trump: 'pique', turnUp: c('carreau', '9'), talon: [c('trefle', '8')],
    trick: [], turn: 0, players: [makeP([c('pique', '7')]), makeP([])], sevenAnnounced: false });
  assert.equal(E.shouldAnnounceAuSept(game), true);
});

test('shouldAnnounceAuSept : faux si déjà annoncé', () => {
  const game = g({ trump: 'pique', turnUp: c('carreau', '9'), talon: [c('trefle', '8')],
    trick: [], turn: 0, players: [makeP([c('pique', '7')]), makeP([])], sevenAnnounced: true });
  assert.equal(E.shouldAnnounceAuSept(game), false);
});
