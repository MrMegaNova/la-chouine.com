import { SUITS, RANKS, ORDER, PTS, SUIT_RANK, SUIT_SYMBOL } from './constants';
import type {
  Card, Rank, Suit, GameState, GameOpts, PlayerState,
  TrickEntry, Combo, Phase, HandResult,
} from './types';

// ─── Deck helpers ─────────────────────────────────────────────────────────────

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ s, r });
  return deck;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort(
    (a, b) => SUIT_RANK[a.s] - SUIT_RANK[b.s] || ORDER[a.r] - ORDER[b.r]
  );
}

export function isBrisque(c: Card): boolean {
  return c.r === 'A' || c.r === '10';
}

// ─── Game initialisation ──────────────────────────────────────────────────────

function makePlayer(): PlayerState {
  return { hand: [], won: [], declared: new Set(), annonce: 0 };
}

export function createGame(opts: GameOpts): GameState {
  const n = opts.playerCount;
  return {
    mode: opts.mode,
    variant: opts.variant,
    playerCount: n,
    diff: opts.diff ?? 'normal',
    target: opts.target,
    names: opts.names,
    oppId: opts.oppId ?? null,
    opts,
    scores: new Array<number>(n).fill(0),
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
    lastTrick: null,
    lastTrickBySeat: new Array(n).fill(null),
    lastAnnounce: null,
    sevenAnnounced: false,
    // Phase de la coupe (#201) : le paquet mélangé est posé caché, chaque siège
    // y piochera (carte déterminée par le moteur) avant la 1ʳᵉ donne.
    cut: { deck: shuffle(buildDeck()), picks: new Array<Card | null>(n).fill(null) },
  };
}

/**
 * Compare deux cartes selon le critère du tirage du donneur. Renvoie true si `a`
 * est **strictement plus petite** que `b` : d'abord la force de la Chouine
 * (`ORDER`, le 7 étant le plus faible), puis, à force égale, l'ordre de rangement
 * des couleurs (`SUIT_RANK` : ♠ < ♥ < ♦ < ♣). Comme les 32 cartes sont uniques,
 * le critère est strict (jamais d'égalité réelle).
 */
function cutLess(a: Card, b: Card): boolean {
  return ORDER[a.r] < ORDER[b.r] || (ORDER[a.r] === ORDER[b.r] && SUIT_RANK[a.s] < SUIT_RANK[b.s]);
}

/** Siège détenant la plus petite carte du tirage (le donneur). */
export function smallestDrawSeat(draws: Card[]): number {
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
export function drawForDealer(playerCount: number): { dealer: number; draws: Card[] } {
  const deck = shuffle(buildDeck());
  const draws: Card[] = [];
  for (let i = 0; i < playerCount; i++) draws.push(deck.pop()!);
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
export function drawCut(game: GameState, seat: number): GameState {
  if (game.phase !== 'cut') return game;
  if (seat < 0 || seat >= game.playerCount) return game;
  if (game.cut.picks[seat] !== null) return game; // siège déjà servi
  if (game.cut.deck.length === 0) return game;

  const deck = [...game.cut.deck];
  const card = deck.pop()!;
  const picks = [...game.cut.picks];
  picks[seat] = card;

  const next: GameState = { ...game, cut: { deck, picks } };

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
export function finishCut(game: GameState): GameState {
  if (game.phase !== 'cutReveal') return game;
  const dealer = smallestDrawSeat(game.cut.picks as Card[]);
  return dealHand(game, dealer);
}

export function dealHand(game: GameState, dealerOverride?: number): GameState {
  const n = game.playerCount;
  const cardsEach = n === 2 ? 5 : 3;
  const deck = shuffle(buildDeck());

  const handNo = game.handNo + 1;
  let dealer: number;
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
  const players: PlayerState[] = Array.from({ length: n }, makePlayer);

  for (let round = 0; round < cardsEach; round++) {
    for (let j = 0; j < n; j++) {
      players[(firstPlayer + j) % n].hand.push(deck.pop()!);
    }
  }

  for (let p = 0; p < n; p++) {
    players[p].hand = sortHand(players[p].hand);
  }

  let trump: GameState['trump'] = null;
  let turnUp: Card | null = null;
  let talon: Card[];

  if (game.variant === 'mondoubleau') {
    talon = deck;
  } else {
    turnUp = deck.pop()!;
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
    lastTrick: null,
    lastTrickBySeat: new Array(n).fill(null),
    lastAnnounce: null,
    gatePending: false,
    sevenAnnounced: false,
    // La coupe est consommée : plus de paquet ni de tirages en attente.
    cut: { deck: [], picks: new Array<Card | null>(n).fill(null) },
  };
}

// ─── Trick resolution ─────────────────────────────────────────────────────────

/** Renvoie true si challenger bat current dans le contexte de ce pli */
export function cardBeats(current: Card, challenger: Card, trump: Suit | null): boolean {
  if (trump !== null) {
    if (challenger.s === trump && current.s !== trump) return true;
    if (current.s === trump && challenger.s !== trump) return false;
  }
  if (challenger.s === current.s) return ORDER[challenger.r] > ORDER[current.r];
  return false;
}

export function resolveTrickWinner(trick: TrickEntry[], trump: Suit | null): number {
  let winnerIdx = 0;
  for (let i = 1; i < trick.length; i++) {
    if (cardBeats(trick[winnerIdx].card, trick[i].card, trump)) {
      winnerIdx = i;
    }
  }
  return trick[winnerIdx].p;
}

// ─── Legal moves ──────────────────────────────────────────────────────────────

export function getLegalMoves(game: GameState, seat: number): Card[] {
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

// ─── Announcements ────────────────────────────────────────────────────────────

export function getAvailableCombos(game: GameState, seat: number): Combo[] {
  return game.playerCount === 2
    ? getCombos2(game, seat)
    : getCombos34(game, seat);
}

function getCombos2(game: GameState, seat: number): Combo[] {
  const { hand, declared } = game.players[seat];
  const isMondo = game.variant === 'mondoubleau' && game.trump === null;
  const res: Combo[] = [];

  for (const s of SUITS) {
    const rs = new Set<Rank>(hand.filter(c => c.s === s).map(c => c.r));
    const chouineRanks: Rank[] = ['A', '10', 'R', 'D', 'V'];
    if (chouineRanks.every(r => rs.has(r))) {
      const sig = `chouine|${s}`;
      if (!declared.has(sig))
        res.push({ type: 'chouine', suit: s, sig, label: `CHOUINE ${SUIT_SYMBOL[s]}`, value: 0, setsTrump: false });
    }
  }

  for (const s of SUITS) {
    const rs = new Set<Rank>(hand.filter(c => c.s === s).map(c => c.r));
    const dbl = game.trump === s ? 2 : 1;
    let type: Combo['type'] | null = null;
    let base = 0;

    const q: Rank[] = ['A', 'R', 'D', 'V'];
    const t: Rank[] = ['R', 'D', 'V'];
    const m: Rank[] = ['R', 'D'];
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

function getCombos34(game: GameState, seat: number): Combo[] {
  const { hand, declared } = game.players[seat];
  const isMondo = game.variant === 'mondoubleau' && game.trump === null;
  const res: Combo[] = [];

  for (const s of SUITS) {
    const rs = new Set<Rank>(hand.filter(c => c.s === s).map(c => c.r));
    const rdv: Rank[] = ['R', 'D', 'V'];
    if (rdv.every(r => rs.has(r))) {
      const sig = `chouine|${s}`;
      if (!declared.has(sig))
        res.push({ type: 'chouine', suit: s, sig, label: `CHOUINE ${SUIT_SYMBOL[s]}`, value: 0, setsTrump: false });
    }
  }

  for (const s of SUITS) {
    const rs = new Set<Rank>(hand.filter(c => c.s === s).map(c => c.r));
    const dbl = game.trump === s ? 2 : 1;
    const rd: Rank[] = ['R', 'D'];
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

// ─── Apply moves (return new state) ───────────────────────────────────────────

/** Cartes de la main qui composent une annonce (#77) — celles à étaler, et
 *  parmi lesquelles la carte jouée avec l'annonce doit être choisie. */
export function comboCards(hand: Card[], combo: Combo): Card[] {
  if (combo.type === 'quinte' || combo.type === 'trente') return hand.filter(isBrisque);
  if (!combo.suit) return [];
  const ranks: Record<string, Rank[]> = {
    mariage: ['R', 'D'],
    tierce: ['R', 'D', 'V'],
    quarteron: ['A', 'R', 'D', 'V'],
    chouine: ['A', '10', 'R', 'D', 'V'], // à 3-4 joueurs la main n'en contient que R, D, V
  };
  const rs = ranks[combo.type] ?? [];
  return hand.filter(c => c.s === combo.suit && rs.includes(c.r));
}

export function applyDeclareCombo(game: GameState, seat: number, combo: Combo): GameState {
  if (combo.type === 'chouine') return game; // handled separately

  const players = game.players.map((p, i) => {
    if (i !== seat) return p;
    const declared = new Set(p.declared);
    declared.add(combo.sig);
    return { ...p, declared, annonce: p.annonce + combo.value };
  });

  const trump = combo.setsTrump && combo.suit ? combo.suit : game.trump;
  // Les cartes de l'annonce sont « étalées sur le tapis » (#77) : on les
  // expose pour que l'adversaire puisse les voir.
  const lastAnnounce = {
    seat, sig: combo.sig, label: combo.label,
    cards: comboCards(game.players[seat].hand, combo),
  };
  return { ...game, players, trump, lastAnnounce };
}

export function applyExchangeSeven(game: GameState, seat: number): GameState {
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

export function applyPlayCard(game: GameState, seat: number, card: Card): GameState {
  // Garde défensif : on ne peut jamais ajouter une carte à un pli déjà complet
  // (il doit d'abord être résolu). Évite l'empilement des cartes si la fonction
  // est appelée pendant le délai de résolution.
  if (game.trick.length >= game.playerCount) return game;

  const players = game.players.map((p, i) => {
    if (i !== seat) return p;
    return { ...p, hand: p.hand.filter(c => c !== card) };
  });
  const trick: TrickEntry[] = [...game.trick, { p: seat, card }];

  if (trick.length === game.playerCount) {
    return { ...game, players, trick };
  }
  return { ...game, players, trick, turn: (seat + 1) % game.playerCount };
}

export function applyResolveTrick(game: GameState): GameState {
  const winner = resolveTrickWinner(game.trick, game.trump);

  const wonCards = game.trick.map(t => t.card);
  const players = game.players.map((p, i) =>
    i === winner ? { ...p, won: [...p.won, ...wonCards] } : p
  );

  // Dernier pli ramassé par ce siège (#95) — `seq` croît à chaque ramassage
  // pour départager le plus récent entre plusieurs adversaires.
  const seq = Math.max(0, ...game.lastTrickBySeat.map(t => t?.seq ?? 0)) + 1;
  const lastTrickBySeat = game.lastTrickBySeat.map((t, i) =>
    i === winner ? { cards: game.trick, seq } : t
  );

  let newGame: GameState = {
    ...game,
    players,
    trick: [],
    leader: winner,
    turn: winner,
    lastTrickWinner: winner,
    lastTrick: { cards: game.trick, winner },
    lastTrickBySeat,
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

function drawCardsAfterTrick(game: GameState, winner: number): GameState {
  const talon = [...game.talon];
  let turnUp = game.turnUp;
  const players = game.players.map(p => ({ ...p, hand: [...p.hand] }));

  for (let i = 0; i < game.playerCount; i++) {
    const seat = (winner + i) % game.playerCount;
    if (talon.length > 0) {
      players[seat].hand.push(talon.pop()!);
    } else if (turnUp) {
      players[seat].hand.push(turnUp);
      turnUp = null;
    }
  }

  const remaining = talon.length + (turnUp ? 1 : 0);
  const phase: Phase = remaining < game.playerCount ? 'final' : 'draw';

  return { ...game, players, talon, turnUp, phase };
}

// ─── End of hand ──────────────────────────────────────────────────────────────

export function computeHandResult(game: GameState, forceWinner?: number): HandResult {
  const cp = game.players.map(p => p.won.reduce((a, c) => a + PTS[c.r], 0));
  const ann = game.players.map(p => p.annonce);
  const der = game.lastTrickWinner;
  const tot = cp.map((v, i) => v + ann[i]);
  if (der != null) tot[der] += 10;

  let winner: number;
  if (forceWinner != null) {
    winner = forceWinner;
  } else {
    const max = Math.max(...tot);
    const tops = tot.reduce<number[]>((acc, score, i) => { if (score === max) acc.push(i); return acc; }, []);
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

export function applyHandResult(game: GameState, result: HandResult): GameState {
  return {
    ...game,
    scores: game.scores.map((s, i) =>
      i === result.winner ? s + 1 : s
    ),
    lastHandDrawn: result.winner < 0,
    handOver: true,
  };
}

// ─── "Au sept" check ─────────────────────────────────────────────────────────

export function shouldAnnounceAuSept(game: GameState): boolean {
  if (game.sevenAnnounced || !game.trump || !game.turnUp) return false;
  if (game.trick.length !== 0) return false;
  const remaining = game.talon.length + 1; // turnUp still exists
  if (remaining > 2) return false;
  return game.players[game.turn].hand.some(c => c.s === game.trump && c.r === '7');
}
