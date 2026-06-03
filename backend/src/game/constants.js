'use strict';

// Portage côté serveur des constantes du moteur de jeu (source de vérité
// partagée avec le frontend : frontend/src/game/constants.ts). Toute évolution
// des règles doit être répercutée dans les deux fichiers — voir engine.js.

const SUITS = ['pique', 'coeur', 'carreau', 'trefle'];

const SUIT_SYMBOL = {
  pique: '♠',
  coeur: '♥',
  carreau: '♦',
  trefle: '♣',
};

const RANKS = ['7', '8', '9', '10', 'V', 'D', 'R', 'A'];

// Force relative d'une carte (0 = la plus faible).
const ORDER = {
  '7': 0, '8': 1, '9': 2, 'V': 3, 'D': 4, 'R': 5, '10': 6, 'A': 7,
};

// Points de comptage d'une carte.
const PTS = {
  '7': 0, '8': 0, '9': 0, 'V': 2, 'D': 3, 'R': 4, '10': 10, 'A': 11,
};

// Ordre de rangement par couleur pour trier la main.
const SUIT_RANK = {
  pique: 0, coeur: 1, carreau: 2, trefle: 3,
};

module.exports = { SUITS, SUIT_SYMBOL, RANKS, ORDER, PTS, SUIT_RANK };
