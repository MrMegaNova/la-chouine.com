import { describe, it, expect } from 'vitest';
import {
  buildDeck, shuffle, sortHand, isBrisque,
  createGame, drawForDealer, dealHand,
  cardBeats, resolveTrickWinner,
  getLegalMoves, getAvailableCombos, comboCards,
  applyDeclareCombo, applyExchangeSeven, applyPlayCard, applyResolveTrick,
  computeHandResult, applyHandResult, shouldAnnounceAuSept,
} from './engine';
import type { Card, GameState, GameOpts, Rank, Suit, TrickEntry } from './types';

// ─── Aides ────────────────────────────────────────────────────────────────────

const c = (s: Suit, r: Rank): Card => ({ s, r });

function opts(over: Partial<GameOpts> = {}): GameOpts {
  return {
    mode: 'local',
    variant: 'classic',
    playerCount: 2,
    target: 3,
    names: ['Alice', 'Bob'],
    ...over,
  };
}

/** Partie 2 joueurs prête à être surchargée champ par champ. */
function game(over: Partial<GameState> = {}): GameState {
  return { ...createGame(opts()), ...over };
}

// ─── Deck ─────────────────────────────────────────────────────────────────────

describe('buildDeck', () => {
  it('produit 32 cartes uniques, 8 par couleur', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(32);
    expect(new Set(deck.map(card => `${card.s}|${card.r}`)).size).toBe(32);
    for (const s of ['pique', 'coeur', 'carreau', 'trefle'] as Suit[]) {
      expect(deck.filter(card => card.s === s)).toHaveLength(8);
    }
  });
});

describe('shuffle', () => {
  it('conserve les cartes et ne mute pas le tableau d’origine', () => {
    const deck = buildDeck();
    const before = [...deck];
    const mixed = shuffle(deck);
    expect(deck).toEqual(before);
    expect(mixed).toHaveLength(32);
    const key = (card: Card) => `${card.s}|${card.r}`;
    expect(new Set(mixed.map(key))).toEqual(new Set(deck.map(key)));
  });
});

describe('sortHand', () => {
  it('trie par couleur (♠♥♦♣) puis par force croissante', () => {
    const hand = [c('trefle', 'A'), c('pique', '10'), c('pique', '7'), c('coeur', 'V')];
    expect(sortHand(hand)).toEqual([
      c('pique', '7'), c('pique', '10'), c('coeur', 'V'), c('trefle', 'A'),
    ]);
  });
});

describe('isBrisque', () => {
  it('reconnaît as et 10 seulement', () => {
    expect(isBrisque(c('pique', 'A'))).toBe(true);
    expect(isBrisque(c('coeur', '10'))).toBe(true);
    expect(isBrisque(c('coeur', 'R'))).toBe(false);
  });
});

// ─── Tirage du donneur ──────────────────────────────────────────────────────

describe('drawForDealer', () => {
  const ORDER: Record<Rank, number> = { '7': 0, '8': 1, '9': 2, V: 3, D: 4, R: 5, '10': 6, A: 7 };
  const SUIT_RANK: Record<Suit, number> = { pique: 0, coeur: 1, carreau: 2, trefle: 3 };
  const less = (a: Card, b: Card) =>
    ORDER[a.r] < ORDER[b.r] || (ORDER[a.r] === ORDER[b.r] && SUIT_RANK[a.s] < SUIT_RANK[b.s]);

  it('tire une carte par siège, toutes distinctes', () => {
    for (let n = 2; n <= 4; n++) {
      const { dealer, draws } = drawForDealer(n);
      expect(draws).toHaveLength(n);
      expect(new Set(draws.map(d => `${d.s}|${d.r}`)).size).toBe(n);
      expect(dealer).toBeGreaterThanOrEqual(0);
      expect(dealer).toBeLessThan(n);
    }
  });

  it('désigne le siège ayant tiré la plus petite carte (force puis couleur)', () => {
    for (let it = 0; it < 200; it++) {
      const { dealer, draws } = drawForDealer(4);
      for (let i = 0; i < draws.length; i++) {
        if (i !== dealer) expect(less(draws[i], draws[dealer])).toBe(false);
      }
    }
  });
});

// ─── Distribution ─────────────────────────────────────────────────────────────

describe('dealHand', () => {
  it('classique à 2 : 5 cartes chacun, retourne l’atout, talon de 21', () => {
    const g = dealHand(game());
    expect(g.players[0].hand).toHaveLength(5);
    expect(g.players[1].hand).toHaveLength(5);
    expect(g.turnUp).not.toBeNull();
    expect(g.trump).toBe(g.turnUp!.s);
    expect(g.talon).toHaveLength(21); // 32 − 10 distribuées − 1 retournée
    expect(g.handNo).toBe(1);
    expect(g.phase).toBe('draw');
    // Le premier joueur est à gauche du donneur et a la main.
    expect(g.leader).toBe((g.dealer + 1) % 2);
    expect(g.turn).toBe(g.leader);
  });

  it('à 3 joueurs : 3 cartes chacun', () => {
    const g = dealHand(game({ ...createGame(opts({ playerCount: 3, names: ['A', 'B', 'C'] })) }));
    for (const p of g.players) expect(p.hand).toHaveLength(3);
    expect(g.talon).toHaveLength(22); // 32 − 9 − 1
  });

  it('mondoubleau : pas d’atout ni de retourne, talon complet', () => {
    const g = dealHand(game({ ...createGame(opts({ variant: 'mondoubleau' })) }));
    expect(g.trump).toBeNull();
    expect(g.turnUp).toBeNull();
    expect(g.talon).toHaveLength(22); // 32 − 10
  });

  it('le donneur tourne à chaque main, sauf après une main nulle', () => {
    let g = dealHand(game());
    const d1 = g.dealer;
    g = dealHand(g);
    expect(g.dealer).toBe((d1 + 1) % 2);
    g = dealHand({ ...g, lastHandDrawn: true });
    expect(g.dealer).toBe((d1 + 1) % 2); // égalité → même donneur
  });
});

// ─── Résolution de pli ────────────────────────────────────────────────────────

describe('cardBeats / resolveTrickWinner', () => {
  it('plus forte carte de la couleur demandée gagne (10 > R)', () => {
    expect(cardBeats(c('pique', 'R'), c('pique', '10'), null)).toBe(true);
    expect(cardBeats(c('pique', '10'), c('pique', 'R'), null)).toBe(false);
  });

  it('l’atout coupe une autre couleur, même un as', () => {
    expect(cardBeats(c('pique', 'A'), c('coeur', '7'), 'coeur')).toBe(true);
    expect(cardBeats(c('coeur', '7'), c('pique', 'A'), 'coeur')).toBe(false);
  });

  it('une carte d’une autre couleur (non atout) ne prend pas', () => {
    expect(cardBeats(c('pique', '7'), c('trefle', 'A'), 'coeur')).toBe(false);
  });

  it('resolveTrickWinner désigne le siège gagnant', () => {
    const trick: TrickEntry[] = [
      { p: 0, card: c('pique', 'A') },
      { p: 1, card: c('coeur', '7') },
    ];
    expect(resolveTrickWinner(trick, 'coeur')).toBe(1); // coupé à l’atout
    expect(resolveTrickWinner(trick, 'carreau')).toBe(0); // défausse
  });
});

// ─── Coups légaux ─────────────────────────────────────────────────────────────

describe('getLegalMoves', () => {
  const hand = [c('pique', '7'), c('pique', 'A'), c('coeur', 'D'), c('trefle', '8')];

  function inTrick(phase: 'draw' | 'final', led: Card, trump: Suit | null): GameState {
    const g = game({ phase, trump, trick: [{ p: 1, card: led }] });
    g.players[0].hand = [...hand];
    return g;
  }

  it('en tête de pli : toute la main', () => {
    const g = game({ phase: 'final', trump: 'coeur' });
    g.players[0].hand = [...hand];
    expect(getLegalMoves(g, 0)).toHaveLength(4);
  });

  it('phase d’écart (draw) : aucune contrainte', () => {
    expect(getLegalMoves(inTrick('draw', c('carreau', 'A'), 'coeur'), 0)).toHaveLength(4);
  });

  it('phase finale : obligation de fournir la couleur demandée', () => {
    const legal = getLegalMoves(inTrick('final', c('pique', 'D'), 'coeur'), 0);
    expect(legal).toEqual([c('pique', '7'), c('pique', 'A')]);
  });

  it('phase finale, atout demandé : obligation de monter si possible', () => {
    const legal = getLegalMoves(inTrick('final', c('pique', 'D'), 'pique'), 0);
    expect(legal).toEqual([c('pique', 'A')]); // le 7 ne monte pas
  });

  it('phase finale, atout demandé sans pouvoir monter : on fournit quand même', () => {
    const legal = getLegalMoves(inTrick('final', c('pique', 'A'), 'pique'), 0);
    expect(legal).toEqual([c('pique', '7'), c('pique', 'A')]);
  });

  it('phase finale, défaut de couleur : obligation de couper', () => {
    const legal = getLegalMoves(inTrick('final', c('carreau', 'A'), 'coeur'), 0);
    expect(legal).toEqual([c('coeur', 'D')]);
  });

  it('phase finale, ni couleur ni atout : tout est permis', () => {
    const legal = getLegalMoves(inTrick('final', c('carreau', 'A'), null), 0);
    expect(legal).toHaveLength(4);
  });
});

// ─── Jouer une carte ──────────────────────────────────────────────────────────

describe('applyPlayCard', () => {
  it('retire la carte de la main, l’ajoute au pli et passe le tour', () => {
    const g = game({ turn: 0 });
    g.players[0].hand = [c('pique', '7'), c('coeur', 'A')];
    g.players[1].hand = [c('trefle', '8'), c('carreau', 'V')];
    const played = g.players[0].hand[0];
    const g2 = applyPlayCard(g, 0, played);
    expect(g2.players[0].hand).toEqual([c('coeur', 'A')]);
    expect(g2.trick).toEqual([{ p: 0, card: played }]);
    expect(g2.turn).toBe(1);
  });

  it('non-régression #21 : refuse une carte sur un pli déjà complet', () => {
    const g = game({
      trick: [
        { p: 0, card: c('pique', '7') },
        { p: 1, card: c('pique', 'A') },
      ],
    });
    g.players[0].hand = [c('coeur', 'D')];
    const g2 = applyPlayCard(g, 0, g.players[0].hand[0]);
    expect(g2).toBe(g); // état strictement inchangé : le pli doit d'abord être résolu
  });

  it('le pli complet n’avance pas le tour (résolution à suivre)', () => {
    const g = game({ turn: 1, trick: [{ p: 0, card: c('pique', '7') }] });
    g.players[1].hand = [c('pique', 'A')];
    const g2 = applyPlayCard(g, 1, g.players[1].hand[0]);
    expect(g2.trick).toHaveLength(2);
    expect(g2.turn).toBe(1);
  });
});

// ─── Résolution + pioche ──────────────────────────────────────────────────────

describe('applyResolveTrick', () => {
  it('le gagnant ramasse le pli, mène, et pioche en premier', () => {
    const g = game({
      trump: 'coeur',
      phase: 'draw',
      talon: [c('trefle', '9'), c('carreau', '9')], // pioche par pop() : carreau d'abord
      turnUp: c('coeur', '7'),
      trick: [
        { p: 0, card: c('pique', 'R') },
        { p: 1, card: c('pique', '10') },
      ],
    });
    const g2 = applyResolveTrick(g);
    expect(g2.lastTrickWinner).toBe(1);
    expect(g2.leader).toBe(1);
    expect(g2.turn).toBe(1);
    expect(g2.trick).toEqual([]);
    expect(g2.players[1].won).toEqual([c('pique', 'R'), c('pique', '10')]);
    // Le dernier pli reste consultable (cartes + vainqueur) — règle #74.
    expect(g2.lastTrick).toEqual({
      cards: [{ p: 0, card: c('pique', 'R') }, { p: 1, card: c('pique', '10') }],
      winner: 1,
    });
    expect(g2.players[1].hand).toContainEqual(c('carreau', '9')); // gagnant pioche en premier
    expect(g2.players[0].hand).toContainEqual(c('trefle', '9'));
  });

  it('mémorise le dernier pli ramassé par chaque siège (#95)', () => {
    // Pli 1 remporté par le siège 1.
    const g1 = applyResolveTrick(game({
      trump: 'coeur', phase: 'final',
      trick: [{ p: 0, card: c('pique', 'R') }, { p: 1, card: c('pique', '10') }],
    }));
    expect(g1.lastTrickBySeat[1]).toEqual({
      cards: [{ p: 0, card: c('pique', 'R') }, { p: 1, card: c('pique', '10') }],
      seq: 1,
    });
    expect(g1.lastTrickBySeat[0]).toBeNull();

    // Pli 2 remporté par le siège 0 : le pli du siège 1 reste consultable —
    // c'est tout l'objet de #95 (lastTrick global ne suffit pas).
    const g2 = applyResolveTrick({
      ...g1,
      trick: [{ p: 1, card: c('carreau', '8') }, { p: 0, card: c('carreau', 'A') }],
    });
    expect(g2.lastTrickBySeat[0]?.seq).toBe(2);
    expect(g2.lastTrickBySeat[1]?.seq).toBe(1);
    expect(g2.lastTrickBySeat[1]?.cards[0].card).toEqual(c('pique', 'R'));
  });

  it('talon vide : la retourne est piochée, puis phase finale', () => {
    const g = game({
      trump: 'coeur',
      phase: 'draw',
      talon: [c('trefle', '9')],
      turnUp: c('coeur', '7'),
      trick: [
        { p: 0, card: c('pique', 'A') },
        { p: 1, card: c('pique', '8') },
      ],
    });
    const g2 = applyResolveTrick(g);
    expect(g2.players[0].hand).toContainEqual(c('trefle', '9'));
    expect(g2.players[1].hand).toContainEqual(c('coeur', '7')); // retourne en dernier
    expect(g2.turnUp).toBeNull();
    expect(g2.phase).toBe('final');
  });

  it('en phase finale, personne ne pioche', () => {
    const g = game({
      trump: 'coeur',
      phase: 'final',
      talon: [],
      turnUp: null,
      trick: [
        { p: 0, card: c('pique', 'A') },
        { p: 1, card: c('pique', '8') },
      ],
    });
    const g2 = applyResolveTrick(g);
    expect(g2.players[0].hand).toHaveLength(0);
    expect(g2.players[1].hand).toHaveLength(0);
    expect(g2.phase).toBe('final');
  });
});

// ─── Annonces ─────────────────────────────────────────────────────────────────

describe('getAvailableCombos (2 joueurs)', () => {
  function withHand(hand: Card[], over: Partial<GameState> = {}): GameState {
    const g = game({ trump: 'coeur', ...over });
    g.players[0].hand = hand;
    return g;
  }

  it('mariage (20), doublé à l’atout (40)', () => {
    const g = withHand([c('pique', 'R'), c('pique', 'D'), c('coeur', 'R'), c('coeur', 'D'), c('trefle', '7')]);
    const combos = getAvailableCombos(g, 0);
    expect(combos.find(x => x.sig === 'mariage|pique')?.value).toBe(20);
    expect(combos.find(x => x.sig === 'mariage|coeur')?.value).toBe(40);
  });

  it('tierce (30) et quarteron (40), la plus haute figure seulement', () => {
    const tierce = getAvailableCombos(withHand(
      [c('pique', 'R'), c('pique', 'D'), c('pique', 'V'), c('coeur', '7'), c('trefle', '7')]), 0);
    expect(tierce.map(x => x.sig)).toEqual(['tierce|pique']);
    expect(tierce[0].value).toBe(30);

    const quarteron = getAvailableCombos(withHand(
      [c('pique', 'A'), c('pique', 'R'), c('pique', 'D'), c('pique', 'V'), c('trefle', '7')]), 0);
    expect(quarteron.map(x => x.sig)).toEqual(['quarteron|pique']);
    expect(quarteron[0].value).toBe(40);
  });

  it('quinte : 5 brisques en main (50)', () => {
    const g = withHand([c('pique', 'A'), c('coeur', 'A'), c('carreau', '10'), c('trefle', '10'), c('pique', '10')]);
    const combos = getAvailableCombos(g, 0);
    expect(combos.find(x => x.sig === 'quinte')?.value).toBe(50);
  });

  it('chouine : A-10-R-D-V d’une même couleur', () => {
    const g = withHand([c('pique', 'A'), c('pique', '10'), c('pique', 'R'), c('pique', 'D'), c('pique', 'V')]);
    const combos = getAvailableCombos(g, 0);
    expect(combos.some(x => x.sig === 'chouine|pique')).toBe(true);
  });

  it('une annonce déjà déclarée n’est plus proposée', () => {
    const g = withHand([c('pique', 'R'), c('pique', 'D'), c('coeur', '7'), c('carreau', '7'), c('trefle', '7')]);
    g.players[0].declared = new Set(['mariage|pique']);
    expect(getAvailableCombos(g, 0)).toEqual([]);
  });

  it('mondoubleau sans atout : le mariage fixe l’atout (setsTrump)', () => {
    const g = withHand(
      [c('pique', 'R'), c('pique', 'D'), c('coeur', '7'), c('carreau', '7'), c('trefle', '7')],
      { variant: 'mondoubleau', trump: null },
    );
    const mariage = getAvailableCombos(g, 0).find(x => x.sig === 'mariage|pique')!;
    expect(mariage.setsTrump).toBe(true);
  });
});

describe('getAvailableCombos (3-4 joueurs)', () => {
  it('chouine = R-D-V, trente = 3 brisques et plus', () => {
    const g = game({ ...createGame(opts({ playerCount: 3, names: ['A', 'B', 'C'] })), trump: 'coeur' });
    g.players[0].hand = [c('pique', 'R'), c('pique', 'D'), c('pique', 'V')];
    let sigs = getAvailableCombos(g, 0).map(x => x.sig);
    expect(sigs).toContain('chouine|pique');
    expect(sigs).toContain('mariage|pique');

    g.players[0].hand = [c('pique', 'A'), c('coeur', '10'), c('carreau', 'A')];
    sigs = getAvailableCombos(g, 0).map(x => x.sig);
    expect(sigs).toEqual(['trente']);
  });
});

describe('comboCards', () => {
  it('renvoie les cartes de la main qui composent l’annonce', () => {
    const hand = [c('pique', 'R'), c('pique', 'D'), c('pique', 'V'), c('coeur', 'R'), c('coeur', 'A')];
    const mariage = { type: 'mariage' as const, suit: 'pique' as Suit, sig: 'mariage|pique', label: '', value: 20, setsTrump: false };
    expect(comboCards(hand, mariage)).toEqual([c('pique', 'R'), c('pique', 'D')]);

    const quinte = { type: 'quinte' as const, suit: null, sig: 'quinte', label: '', value: 50, setsTrump: false };
    expect(comboCards(hand, quinte)).toEqual([c('coeur', 'A')]); // les brisques de la main

    const chouine = { type: 'chouine' as const, suit: 'pique' as Suit, sig: 'chouine|pique', label: '', value: 0, setsTrump: false };
    expect(comboCards(hand, chouine)).toEqual([c('pique', 'R'), c('pique', 'D'), c('pique', 'V')]);
  });
});

describe('applyDeclareCombo', () => {
  it('étale les cartes de l’annonce (lastAnnounce) pour l’adversaire', () => {
    const g = game({ trump: 'coeur' });
    g.players[0].hand = [c('pique', 'R'), c('pique', 'D'), c('trefle', '7')];
    const combo = {
      type: 'mariage' as const, suit: 'pique' as Suit, sig: 'mariage|pique',
      label: 'Mariage ♠', value: 20, setsTrump: false,
    };
    const g2 = applyDeclareCombo(g, 0, combo);
    expect(g2.lastAnnounce).toEqual({
      seat: 0, sig: 'mariage|pique', label: 'Mariage ♠',
      cards: [c('pique', 'R'), c('pique', 'D')],
    });
  });

  it('crédite l’annonce, la marque déclarée, et fixe l’atout si setsTrump', () => {
    const g = game({ variant: 'mondoubleau', trump: null });
    const combo = {
      type: 'mariage' as const, suit: 'pique' as Suit, sig: 'mariage|pique',
      label: 'Mariage ♠', value: 20, setsTrump: true,
    };
    const g2 = applyDeclareCombo(g, 0, combo);
    expect(g2.players[0].annonce).toBe(20);
    expect(g2.players[0].declared.has('mariage|pique')).toBe(true);
    expect(g2.trump).toBe('pique');
    expect(g.players[0].annonce).toBe(0); // immuabilité de l'état d'origine
  });

  it('la chouine ne passe pas par le cumul d’annonces', () => {
    const g = game();
    const combo = {
      type: 'chouine' as const, suit: 'pique' as Suit, sig: 'chouine|pique',
      label: 'CHOUINE ♠', value: 0, setsTrump: false,
    };
    expect(applyDeclareCombo(g, 0, combo)).toBe(g);
  });
});

// ─── Échange du 7 d'atout ─────────────────────────────────────────────────────

describe('applyExchangeSeven', () => {
  it('échange le 7 d’atout contre la retourne', () => {
    const g = game({ trump: 'coeur', turnUp: c('coeur', 'A'), phase: 'draw' });
    g.players[0].hand = [c('coeur', '7'), c('pique', '8')];
    const g2 = applyExchangeSeven(g, 0);
    expect(g2.turnUp).toEqual(c('coeur', '7'));
    expect(g2.players[0].hand).toContainEqual(c('coeur', 'A'));
    expect(g2.players[0].hand).not.toContainEqual(c('coeur', '7'));
  });

  it('sans 7 d’atout en main, ou en phase finale : aucun effet', () => {
    const g = game({ trump: 'coeur', turnUp: c('coeur', 'A'), phase: 'draw' });
    g.players[0].hand = [c('pique', '7')];
    expect(applyExchangeSeven(g, 0)).toBe(g);

    const fin = game({ trump: 'coeur', turnUp: c('coeur', 'A'), phase: 'final' });
    fin.players[0].hand = [c('coeur', '7')];
    expect(applyExchangeSeven(fin, 0)).toBe(fin);
  });
});

// ─── Score de fin de main ─────────────────────────────────────────────────────

describe('computeHandResult', () => {
  it('compte cartes + annonces + 10 de der et désigne le gagnant', () => {
    const g = game();
    g.players[0].won = [c('pique', 'A'), c('coeur', '10')]; // 21 points
    g.players[1].won = [c('pique', 'R'), c('coeur', 'D')];  // 7 points
    g.players[1].annonce = 20;
    const r = computeHandResult({ ...g, lastTrickWinner: 1 });
    expect(r.cp).toEqual([21, 7]);
    expect(r.ann).toEqual([0, 20]);
    expect(r.tot).toEqual([21, 37]); // 7 + 20 + 10 de der
    expect(r.winner).toBe(1);
    expect(r.matchWinner).toBeNull();
  });

  it('égalité parfaite : main nulle (winner = -1)', () => {
    const g = game();
    g.players[0].won = [c('pique', 'A')];  // 11
    g.players[1].won = [c('coeur', 'A')];  // 11
    const r = computeHandResult({ ...g, lastTrickWinner: null });
    expect(r.winner).toBe(-1);
    expect(r.forced).toBe(false);
  });

  it('gagnant forcé (chouine) et victoire du match à la cible', () => {
    const g = game({ scores: [2, 0] }); // cible 3
    const r = computeHandResult(g, 0);
    expect(r.forced).toBe(true);
    expect(r.winner).toBe(0);
    expect(r.matchWinner).toBe(0);
  });
});

describe('applyHandResult', () => {
  it('incrémente le score du gagnant et marque la main finie', () => {
    const g = game();
    const r = computeHandResult(g, 0);
    const g2 = applyHandResult(g, r);
    expect(g2.scores).toEqual([1, 0]);
    expect(g2.handOver).toBe(true);
    expect(g2.lastHandDrawn).toBe(false);
  });

  it('main nulle : aucun score, lastHandDrawn levé', () => {
    const g = game();
    g.players[0].won = [c('pique', 'A')];
    g.players[1].won = [c('coeur', 'A')];
    const r = computeHandResult(g);
    const g2 = applyHandResult(g, r);
    expect(g2.scores).toEqual([0, 0]);
    expect(g2.lastHandDrawn).toBe(true);
  });
});

// ─── Annonce « au sept » ──────────────────────────────────────────────────────

describe('shouldAnnounceAuSept', () => {
  it('signale le 7 d’atout quand il reste au plus 2 cartes à piocher', () => {
    const g = game({ trump: 'coeur', turnUp: c('coeur', 'A'), talon: [c('pique', '8')], turn: 0 });
    g.players[0].hand = [c('coeur', '7')];
    expect(shouldAnnounceAuSept(g)).toBe(true);
  });

  it('muet si trop de talon, déjà annoncé, ou pli entamé', () => {
    const big = game({ trump: 'coeur', turnUp: c('coeur', 'A'), talon: buildDeck().slice(0, 5), turn: 0 });
    big.players[0].hand = [c('coeur', '7')];
    expect(shouldAnnounceAuSept(big)).toBe(false);

    const done = game({ trump: 'coeur', turnUp: c('coeur', 'A'), talon: [], turn: 0, sevenAnnounced: true });
    done.players[0].hand = [c('coeur', '7')];
    expect(shouldAnnounceAuSept(done)).toBe(false);

    const midTrick = game({
      trump: 'coeur', turnUp: c('coeur', 'A'), talon: [], turn: 0,
      trick: [{ p: 1, card: c('pique', '8') }],
    });
    midTrick.players[0].hand = [c('coeur', '7')];
    expect(shouldAnnounceAuSept(midTrick)).toBe(false);
  });
});
