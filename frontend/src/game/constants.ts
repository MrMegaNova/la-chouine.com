import type { Suit, Rank } from './types';

export const SUITS: Suit[] = ['pique', 'coeur', 'carreau', 'trefle'];

export const SUIT_SYMBOL: Record<Suit, string> = {
  pique: '♠',
  coeur: '♥',
  carreau: '♦',
  trefle: '♣',
};

export const RANKS: Rank[] = ['7', '8', '9', '10', 'V', 'D', 'R', 'A'];

/** Force relative d'une carte (0 = la plus faible) */
export const ORDER: Record<Rank, number> = {
  '7': 0, '8': 1, '9': 2, 'V': 3, 'D': 4, 'R': 5, '10': 6, 'A': 7,
};

/** Points de comptage d'une carte */
export const PTS: Record<Rank, number> = {
  '7': 0, '8': 0, '9': 0, 'V': 2, 'D': 3, 'R': 4, '10': 10, 'A': 11,
};

/** Ordre de rangement par couleur pour trier la main */
export const SUIT_RANK: Record<Suit, number> = {
  pique: 0, coeur: 1, carreau: 2, trefle: 3,
};
