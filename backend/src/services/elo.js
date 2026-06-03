'use strict';

// ─── Moteur de classement Elo ─────────────────────────────────────────────────
// Implémentation standard (identique aux échecs). Fonctions pures, sans aucune
// dépendance à la base : entièrement testable unitairement.

// Note de départ d'un nouveau joueur.
const INITIAL_RATING = 1500;

// Facteur K : amplitude maximale d'un ajustement par partie.
const K_FACTOR = 32;

/**
 * Probabilité attendue que le joueur A batte le joueur B compte tenu de l'écart
 * de notes. Renvoie une valeur dans ]0, 1[. expectedScore(a,b) + expectedScore(b,a) === 1.
 * @param {number} ratingA
 * @param {number} ratingB
 * @returns {number}
 */
function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * Nouvelle note d'un joueur après une partie.
 * @param {number} rating   Note actuelle
 * @param {number} expected Espérance de gain (expectedScore)
 * @param {number} actual   Résultat réel : 1 = victoire, 0 = défaite, 0.5 = nul
 * @param {number} [k]      Facteur K
 * @returns {number} Note arrondie à l'entier
 */
function nextRating(rating, expected, actual, k = K_FACTOR) {
  return Math.round(rating + k * (actual - expected));
}

/**
 * Calcule les nouvelles notes des deux joueurs d'une partie 1 contre 1.
 * À K égal, le gain du vainqueur égale la perte du perdant (somme des deltas nulle).
 * @param {number}  ratingA Note du joueur A
 * @param {number}  ratingB Note du joueur B
 * @param {boolean} aWon    true si A a gagné, false si B a gagné (pas de nul)
 * @param {number}  [k]     Facteur K
 * @returns {{ a: number, b: number }} Nouvelles notes
 */
function computePairUpdate(ratingA, ratingB, aWon, k = K_FACTOR) {
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = expectedScore(ratingB, ratingA);
  const actualA = aWon ? 1 : 0;
  const actualB = aWon ? 0 : 1;
  return {
    a: nextRating(ratingA, expectedA, actualA, k),
    b: nextRating(ratingB, expectedB, actualB, k),
  };
}

module.exports = {
  INITIAL_RATING,
  K_FACTOR,
  expectedScore,
  nextRating,
  computePairUpdate,
};
