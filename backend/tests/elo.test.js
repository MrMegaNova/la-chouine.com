'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  INITIAL_RATING,
  K_FACTOR,
  expectedScore,
  nextRating,
  computePairUpdate,
} = require('../src/services/elo');

test('constantes : départ à 1500, K = 32', () => {
  assert.equal(INITIAL_RATING, 1500);
  assert.equal(K_FACTOR, 32);
});

test('expectedScore : joueurs de même note → 0.5', () => {
  assert.equal(expectedScore(1500, 1500), 0.5);
});

test('expectedScore : les deux espérances somment à 1', () => {
  const a = expectedScore(1700, 1300);
  const b = expectedScore(1300, 1700);
  assert.ok(Math.abs(a + b - 1) < 1e-9);
});

test('expectedScore : le favori a une espérance > 0.5', () => {
  assert.ok(expectedScore(1800, 1500) > 0.5);
  assert.ok(expectedScore(1500, 1800) < 0.5);
});

test('nextRating : victoire attendue à 50 % avec K=32 → +16', () => {
  assert.equal(nextRating(1500, 0.5, 1), 1516);
  assert.equal(nextRating(1500, 0.5, 0), 1484);
});

test('computePairUpdate : 1500 vs 1500, A gagne → 1516 / 1484', () => {
  const { a, b } = computePairUpdate(1500, 1500, true);
  assert.equal(a, 1516);
  assert.equal(b, 1484);
});

test('computePairUpdate : conservation — le gain du vainqueur = la perte du perdant', () => {
  const ra = 1640, rb = 1480;
  const { a, b } = computePairUpdate(ra, rb, true);
  assert.equal(a - ra, rb - b);
});

test('computePairUpdate : un outsider qui gagne marque plus qu’un favori qui gagne', () => {
  const favWins = computePairUpdate(1800, 1500, true);     // favori gagne
  const underdogWins = computePairUpdate(1500, 1800, true); // outsider gagne
  const favGain = favWins.a - 1800;
  const underdogGain = underdogWins.a - 1500;
  assert.ok(underdogGain > favGain);
});

test('computePairUpdate : symétrique selon le vainqueur', () => {
  const aWins = computePairUpdate(1550, 1450, true);
  const bWins = computePairUpdate(1550, 1450, false);
  // Si A gagne il monte ; si B gagne A descend.
  assert.ok(aWins.a > 1550);
  assert.ok(bWins.a < 1550);
});
