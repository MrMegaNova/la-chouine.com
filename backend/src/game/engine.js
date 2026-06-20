'use strict';

// ─── Moteur de jeu de la Chouine — portage serveur ────────────────────────────
// Portage CommonJS du moteur pur du frontend (frontend/src/game/engine.ts), pour
// permettre un arbitrage **autoritatif côté serveur** des parties PvP en ligne.
//
// ⚠️ Logique dupliquée volontairement (le backend est en JS, le frontend en TS,
// sans tooling de package partagé). Toute évolution des règles doit être
// répercutée dans les deux fichiers ; la suite de tests `backend/tests/engine.test.js`
// verrouille le comportement. Une consolidation en package partagé est à envisager.
//
// Seule adaptation par rapport au frontend : `applyPlayCard` retire la carte de
// la main **par valeur** (couleur + rang) et non par référence d'objet, car les
// coups arrivent du réseau sous forme d'objets simples. Les cartes étant uniques
// dans un jeu de 32, c'est strictement équivalent.

const { SUITS, RANKS, ORDER, PTS, SUIT_RANK, SUIT_SYMBOL } = require('./constants');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sameCard(a, b) {
  return a.s === b.s && a.r === b.r;
}

function buildDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ s, r });
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortHand(hand) {
  return [...hand].sort(
    (a, b) => SUIT_RANK[a.s] - SUIT_RANK[b.s] || ORDER[a.r] - ORDER[b.r]
  );
}

function isBrisque(c) {
  return c.r === 'A' || c.r === '10';
}

// ─── Initialisation ───────────────────────────────────────────────────────────

function makePlayer() {
  return { hand: [], won: [], declared: new Set(), annonce: 0 };
}

function createGame(opts) {
  const n = opts.playerCount;
  return {
    mode: opts.mode,
    variant: opts.variant,
    playerCount: n,
    diff: opts.diff || 'normal',
    target: opts.target,
    names: opts.names,
    oppId: opts.oppId || null,
    opts,
    scores: new Array(n).fill(0),
    dealer: -1,
    handNo: 0,
    lastHandDrawn: false,
    recorded: false,
    viewPlayer: 0,
    gatePending: false,
    players: Array.from({ length: n }, makePlayer),
    trump: null,
    turnUp: null,
    talon: [],
    trick: [],
    leader: 0,
    turn: 0,
    phase: 'cut',
    handOver: false,
    lastTrickWinner: null,
    lastAnnounce: null,
    sevenAnnounced: false,
    // Phase de la coupe (#201) : le paquet mélangé est posé caché, chaque siège
    // y piochera (carte déterminée par le moteur) avant la 1ʳᵉ donne.
    cut: { deck: shuffle(buildDeck()), picks: new Array(n).fill(null) },
  };
}

/**
 * Compare deux cartes selon le critère du tirage du donneur. Renvoie true si `a`
 * est **strictement plus petite** que `b` : d'abord la force de la Chouine
 * (`ORDER`, le 7 étant le plus faible), puis, à force égale, l'ordre de rangement
 * des couleurs (`SUIT_RANK` : ♠ < ♥ < ♦ < ♣). Comme les 32 cartes sont uniques,
 * le critère est strict (jamais d'égalité réelle).
 */
function cutLess(a, b) {
  return ORDER[a.r] < ORDER[b.r] || (ORDER[a.r] === ORDER[b.r] && SUIT_RANK[a.s] < SUIT_RANK[b.s]);
}

/** Siège détenant la plus petite carte du tirage (le donneur). */
function smallestDrawSeat(draws) {
  let dealer = 0;
  for (let i = 1; i < draws.length; i++) {
    if (cutLess(draws[i], draws[dealer])) dealer = i;
  }
  return dealer;
}

/**
 * Tirage du donneur initial (début de match) : chaque siège tire une carte d'un
 * paquet mélangé, dans l'ordre des sièges (0, 1, … n−1). La **plus petite** carte
 * désigne le donneur, qui distribue le premier coup.
 *
 * Conservé pour les fixtures de parité (#199) ; la version interactive passe par
 * `drawCut` (#201). Comme les 32 cartes sont toutes uniques, le critère
 * `(force, couleur)` est **strict** : le donneur est toujours déterminé sans
 * re-tirage.
 */
function drawForDealer(playerCount) {
  const deck = shuffle(buildDeck());
  const draws = [];
  for (let i = 0; i < playerCount; i++) draws.push(deck.pop());
  return { dealer: smallestDrawSeat(draws), draws };
}

/**
 * Pioche interactive de la coupe (#201) : le siège `seat` retourne la carte du
 * dessus du paquet caché (`cut.deck`) — la carte est **déterminée par le moteur**,
 * jamais par le client (déterminisme + invariant #116). Quand tous les sièges ont
 * pioché, on passe en `phase: 'cutReveal'` **sans distribuer** : les cartes tirées
 * restent affichées (`cut.picks` conservé) le temps d'annoncer le donneur. La donne
 * proprement dite est ensuite déclenchée par `finishCut` (#201). Sinon, renvoie
 * l'état inchangé (pioche refusée).
 */
function drawCut(game, seat) {
  if (game.phase !== 'cut') return game;
  if (seat < 0 || seat >= game.playerCount) return game;
  if (game.cut.picks[seat] !== null) return game; // siège déjà servi
  if (game.cut.deck.length === 0) return game;

  const deck = [...game.cut.deck];
  const card = deck.pop();
  const picks = [...game.cut.picks];
  picks[seat] = card;

  const next = { ...game, cut: { deck, picks } };

  // Tous les sièges ont tiré → on connaît le donneur, mais on diffère la donne :
  // les cartes restent révélées (phase de transition `cutReveal`).
  if (picks.every(p => p !== null)) {
    return { ...next, phase: 'cutReveal' };
  }
  return next;
}

/**
 * Clôture de la phase de révélation (#201) : valide `phase === 'cutReveal'`,
 * détermine le donneur via la plus petite carte (`cut.picks`) et distribue la
 * 1ʳᵉ main (`dealHand`, transition `cutReveal` → `draw`, `cut` remis à zéro).
 * Hors phase `cutReveal`, renvoie l'état inchangé.
 */
function finishCut(game) {
  if (game.phase !== 'cutReveal') return game;
  const dealer = smallestDrawSeat(game.cut.picks);
  return dealHand(game, dealer);
}

function dealHand(game, dealerOverride) {
  const n = game.playerCount;
  const cardsEach = n === 2 ? 5 : 3;
  const deck = shuffle(buildDeck());

  const handNo = game.handNo + 1;
  let dealer;
  if (dealerOverride != null) {
    dealer = dealerOverride; // donneur imposé par la coupe (#201)
  } else if (handNo === 1) {
    dealer = drawForDealer(n).dealer; // tirage : la plus petite carte donne
  } else if (game.lastHandDrawn) {
    dealer = game.dealer; // égalité → même donneur
  } else {
    dealer = (game.dealer + 1) % n;
  }

  const firstPlayer = (dealer + 1) % n;
  const players = Array.from({ length: n }, makePlayer);

  for (let round = 0; round < cardsEach; round++) {
    for (let j = 0; j < n; j++) {
      players[(firstPlayer + j) % n].hand.push(deck.pop());
    }
  }

  for (let p = 0; p < n; p++) {
    players[p].hand = sortHand(players[p].hand);
  }

  let trump = null;
  let turnUp = null;
  let talon;

  if (game.variant === 'mondoubleau') {
    talon = deck;
  } else {
    turnUp = deck.pop();
    trump = turnUp.s;
    talon = deck;
  }

  return {
    ...game,
    handNo,
    dealer,
    lastHandDrawn: false,
    recorded: false,
    viewPlayer: game.mode === 'local' ? firstPlayer : 0,
    players,
    trump,
    turnUp,
    talon,
    trick: [],
    leader: firstPlayer,
    turn: firstPlayer,
    phase: 'draw',
    handOver: false,
    lastTrickWinner: null,
    lastAnnounce: null,
    gatePending: false,
    sevenAnnounced: false,
    // La coupe est consommée : plus de paquet ni de tirages en attente.
    cut: { deck: [], picks: new Array(n).fill(null) },
  };
}

// ─── Résolution de pli ────────────────────────────────────────────────────────

/** true si `challenger` bat `current` dans le contexte de ce pli. */
function cardBeats(current, challenger, trump) {
  if (trump !== null) {
    if (challenger.s === trump && current.s !== trump) return true;
    if (current.s === trump && challenger.s !== trump) return false;
  }
  if (challenger.s === current.s) return ORDER[challenger.r] > ORDER[current.r];
  return false;
}

function resolveTrickWinner(trick, trump) {
  let winnerIdx = 0;
  for (let i = 1; i < trick.length; i++) {
    if (cardBeats(trick[winnerIdx].card, trick[i].card, trump)) {
      winnerIdx = i;
    }
  }
  return trick[winnerIdx].p;
}

// ─── Coups légaux ─────────────────────────────────────────────────────────────

function getLegalMoves(game, seat) {
  const hand = game.players[seat].hand;
  if (game.trick.length === 0) return hand;

  const led = game.trick[0].card;
  if (game.phase === 'draw') return hand;

  const same = hand.filter(c => c.s === led.s);
  if (same.length > 0) {
    if (game.trump !== null && led.s === game.trump) {
      const higher = same.filter(c => ORDER[c.r] > ORDER[led.r]);
      return higher.length > 0 ? higher : same;
    }
    return same;
  }

  if (game.trump !== null) {
    const trumpCards = hand.filter(c => c.s === game.trump);
    if (trumpCards.length > 0) return trumpCards;
  }

  return hand;
}

function isLegalMove(game, seat, card) {
  return getLegalMoves(game, seat).some(c => sameCard(c, card));
}

// ─── Annonces ─────────────────────────────────────────────────────────────────

function getAvailableCombos(game, seat) {
  return game.playerCount === 2
    ? getCombos2(game, seat)
    : getCombos34(game, seat);
}

function getCombos2(game, seat) {
  const { hand, declared } = game.players[seat];
  const isMondo = game.variant === 'mondoubleau' && game.trump === null;
  const res = [];

  for (const s of SUITS) {
    const rs = new Set(hand.filter(c => c.s === s).map(c => c.r));
    const chouineRanks = ['A', '10', 'R', 'D', 'V'];
    if (chouineRanks.every(r => rs.has(r))) {
      const sig = `chouine|${s}`;
      if (!declared.has(sig))
        res.push({ type: 'chouine', suit: s, sig, label: `CHOUINE ${SUIT_SYMBOL[s]}`, value: 0, setsTrump: false });
    }
  }

  for (const s of SUITS) {
    const rs = new Set(hand.filter(c => c.s === s).map(c => c.r));
    const dbl = game.trump === s ? 2 : 1;
    let type = null;
    let base = 0;

    const q = ['A', 'R', 'D', 'V'];
    const t = ['R', 'D', 'V'];
    const m = ['R', 'D'];
    if (q.every(r => rs.has(r))) { type = 'quarteron'; base = 40; }
    else if (t.every(r => rs.has(r))) { type = 'tierce'; base = 30; }
    else if (m.every(r => rs.has(r))) { type = 'mariage'; base = 20; }

    if (type) {
      const sig = `${type}|${s}`;
      const label = `${type.charAt(0).toUpperCase() + type.slice(1)} ${SUIT_SYMBOL[s]}`;
      if (!declared.has(sig))
        res.push({ type, suit: s, sig, label, value: base * dbl, setsTrump: isMondo });
    }
  }

  const nbBrisques = hand.filter(isBrisque).length;
  if (nbBrisques >= 5 && !declared.has('quinte'))
    res.push({ type: 'quinte', suit: null, sig: 'quinte', label: 'Quinte', value: 50, setsTrump: false });

  return res;
}

function getCombos34(game, seat) {
  const { hand, declared } = game.players[seat];
  const isMondo = game.variant === 'mondoubleau' && game.trump === null;
  const res = [];

  for (const s of SUITS) {
    const rs = new Set(hand.filter(c => c.s === s).map(c => c.r));
    const rdv = ['R', 'D', 'V'];
    if (rdv.every(r => rs.has(r))) {
      const sig = `chouine|${s}`;
      if (!declared.has(sig))
        res.push({ type: 'chouine', suit: s, sig, label: `CHOUINE ${SUIT_SYMBOL[s]}`, value: 0, setsTrump: false });
    }
  }

  for (const s of SUITS) {
    const rs = new Set(hand.filter(c => c.s === s).map(c => c.r));
    const dbl = game.trump === s ? 2 : 1;
    const rd = ['R', 'D'];
    if (rd.every(r => rs.has(r))) {
      const sig = `mariage|${s}`;
      if (!declared.has(sig))
        res.push({ type: 'mariage', suit: s, sig, label: `Mariage ${SUIT_SYMBOL[s]}`, value: 20 * dbl, setsTrump: isMondo });
    }
  }

  const nb = hand.filter(isBrisque).length;
  if (nb >= 3 && !declared.has('trente'))
    res.push({ type: 'trente', suit: null, sig: 'trente', label: `Trente (${nb} brisques)`, value: 30, setsTrump: false });

  return res;
}

// ─── Application des coups (retournent un nouvel état) ─────────────────────────

/** Cartes de la main qui composent une annonce (#77) — celles à étaler, et
 *  parmi lesquelles la carte jouée avec l'annonce doit être choisie. */
function comboCards(hand, combo) {
  if (combo.type === 'quinte' || combo.type === 'trente') return hand.filter(isBrisque);
  if (!combo.suit) return [];
  const ranks = {
    mariage: ['R', 'D'],
    tierce: ['R', 'D', 'V'],
    quarteron: ['A', 'R', 'D', 'V'],
    chouine: ['A', '10', 'R', 'D', 'V'], // à 3-4 joueurs la main n'en contient que R, D, V
  }[combo.type] || [];
  return hand.filter(c => c.s === combo.suit && ranks.includes(c.r));
}

function applyDeclareCombo(game, seat, combo) {
  if (combo.type === 'chouine') return game; // géré séparément

  const players = game.players.map((p, i) => {
    if (i !== seat) return p;
    const declared = new Set(p.declared);
    declared.add(combo.sig);
    return { ...p, declared, annonce: p.annonce + combo.value };
  });

  const trump = combo.setsTrump && combo.suit ? combo.suit : game.trump;
  // Les cartes de l'annonce sont « étalées sur le tapis » (#77).
  const lastAnnounce = {
    seat, sig: combo.sig, label: combo.label,
    cards: comboCards(game.players[seat].hand, combo),
  };
  return { ...game, players, trump, lastAnnounce };
}

function applyExchangeSeven(game, seat) {
  if (!game.turnUp || game.phase !== 'draw' || game.trump === null) return game;
  const hand = game.players[seat].hand;
  const idx = hand.findIndex(c => c.s === game.trump && c.r === '7');
  if (idx < 0) return game;

  const newHand = [...hand];
  const seven = newHand[idx];
  newHand[idx] = game.turnUp;
  const players = game.players.map((p, i) =>
    i === seat ? { ...p, hand: sortHand(newHand) } : p
  );
  return { ...game, players, turnUp: seven };
}

function applyPlayCard(game, seat, card) {
  // Garde défensif : on ne peut jamais ajouter une carte à un pli déjà complet
  // (cf. bug #21). Le pli doit d'abord être résolu.
  if (game.trick.length >= game.playerCount) return game;

  let removed = false;
  const players = game.players.map((p, i) => {
    if (i !== seat) return p;
    const hand = [];
    for (const c of p.hand) {
      if (!removed && sameCard(c, card)) { removed = true; continue; }
      hand.push(c);
    }
    return { ...p, hand };
  });
  const trick = [...game.trick, { p: seat, card }];

  if (trick.length === game.playerCount) {
    return { ...game, players, trick };
  }
  return { ...game, players, trick, turn: (seat + 1) % game.playerCount };
}

function applyResolveTrick(game) {
  const winner = resolveTrickWinner(game.trick, game.trump);

  const wonCards = game.trick.map(t => t.card);
  const players = game.players.map((p, i) =>
    i === winner ? { ...p, won: [...p.won, ...wonCards] } : p
  );

  let newGame = {
    ...game,
    players,
    trick: [],
    leader: winner,
    turn: winner,
    lastTrickWinner: winner,
  };

  if (game.phase === 'draw') {
    newGame = drawCardsAfterTrick(newGame, winner);
  }

  newGame = {
    ...newGame,
    players: newGame.players.map(pl => ({ ...pl, hand: sortHand(pl.hand) })),
  };

  return newGame;
}

function drawCardsAfterTrick(game, winner) {
  let talon = [...game.talon];
  let turnUp = game.turnUp;
  const players = game.players.map(p => ({ ...p, hand: [...p.hand] }));

  for (let i = 0; i < game.playerCount; i++) {
    const seat = (winner + i) % game.playerCount;
    if (talon.length > 0) {
      players[seat].hand.push(talon.pop());
    } else if (turnUp) {
      players[seat].hand.push(turnUp);
      turnUp = null;
    }
  }

  const remaining = talon.length + (turnUp ? 1 : 0);
  const phase = remaining < game.playerCount ? 'final' : 'draw';

  return { ...game, players, talon, turnUp, phase };
}

// ─── Fin de main ──────────────────────────────────────────────────────────────

function computeHandResult(game, forceWinner) {
  const cp = game.players.map(p => p.won.reduce((a, c) => a + PTS[c.r], 0));
  const ann = game.players.map(p => p.annonce);
  const der = game.lastTrickWinner;
  const tot = cp.map((v, i) => v + ann[i]);
  if (der != null) tot[der] += 10;

  let winner;
  if (forceWinner != null) {
    winner = forceWinner;
  } else {
    const max = Math.max(...tot);
    const tops = tot.reduce((acc, score, i) => { if (score === max) acc.push(i); return acc; }, []);
    winner = tops.length === 1 ? tops[0] : -1;
  }

  const newScores = [...game.scores];
  if (winner >= 0) newScores[winner]++;

  const matchWinner = newScores.findIndex(s => s >= game.target);

  return {
    cp,
    ann,
    der,
    tot,
    winner,
    forced: forceWinner != null,
    matchWinner: matchWinner >= 0 ? matchWinner : null,
  };
}

function applyHandResult(game, result) {
  return {
    ...game,
    scores: game.scores.map((s, i) =>
      i === result.winner ? s + 1 : s
    ),
    lastHandDrawn: result.winner < 0,
    handOver: true,
  };
}

// ─── « Au sept » ──────────────────────────────────────────────────────────────

function shouldAnnounceAuSept(game) {
  if (game.sevenAnnounced || !game.trump || !game.turnUp) return false;
  if (game.trick.length !== 0) return false;
  const remaining = game.talon.length + 1; // turnUp existe encore
  if (remaining > 2) return false;
  return game.players[game.turn].hand.some(c => c.s === game.trump && c.r === '7');
}

module.exports = {
  sameCard,
  buildDeck,
  shuffle,
  sortHand,
  isBrisque,
  createGame,
  drawForDealer,
  smallestDrawSeat,
  drawCut,
  finishCut,
  dealHand,
  cardBeats,
  resolveTrickWinner,
  getLegalMoves,
  isLegalMove,
  getAvailableCombos,
  comboCards,
  applyDeclareCombo,
  applyExchangeSeven,
  applyPlayCard,
  applyResolveTrick,
  computeHandResult,
  applyHandResult,
  shouldAnnounceAuSept,
};
