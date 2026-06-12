'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const clk = require('../src/game/turnClock');

const opts = { baseMs: 20_000, reserveMs: 120_000, pauseBudgetMs: 90_000, maxTimeouts: 3 };

test('startTurn : échéance = base + réserve du siège', () => {
  const c = clk.createClock(opts);
  clk.startTurn(c, 0, 1_000);
  assert.equal(c.deadline, 1_000 + 20_000 + 120_000);
  assert.equal(clk.remainingMs(c, 1_000), 140_000);
});

test('commitMove : un coup sous BASE ne touche pas la réserve', () => {
  const c = clk.createClock(opts);
  clk.startTurn(c, 0, 0);
  clk.commitMove(c, 15_000); // 15 s < base 20 s
  assert.equal(c.reserve[0], 120_000);
});

test('commitMove : le dépassement de BASE est déduit de la réserve', () => {
  const c = clk.createClock(opts);
  clk.startTurn(c, 0, 0);
  clk.commitMove(c, 50_000); // 50 s → 30 s au-delà de base
  assert.equal(c.reserve[0], 120_000 - 30_000);
});

test('réserve épuisée : le coup est plafonné à BASE', () => {
  const c = clk.createClock({ ...opts, reserveMs: 10_000 });
  clk.startTurn(c, 0, 0);
  assert.equal(clk.remainingMs(c, 0), 30_000); // base 20 + réserve 10
  clk.commitMove(c, 30_000); // épuise la réserve
  assert.equal(c.reserve[0], 0);
  clk.startTurn(c, 0, 100_000);
  assert.equal(clk.remainingMs(c, 100_000), 20_000, 'plus que la base');
});

test('pause/reprise : l’échéance est repoussée du temps de pause', () => {
  const c = clk.createClock(opts);
  clk.startTurn(c, 0, 0);
  const d0 = c.deadline;
  // L'adversaire (siège 1) se déconnecte à t=5s, revient à t=12s (7 s de pause).
  assert.equal(clk.pause(c, 1, 5_000), true);
  assert.equal(clk.remainingMs(c, 9_000), d0 - 5_000, 'gelé pendant la pause');
  clk.resume(c, 12_000);
  assert.equal(c.deadline, d0 + 7_000, 'échéance repoussée de 7 s');
  assert.equal(c.pauseBudget[1], 90_000 - 7_000, 'budget du déconnecté débité');
});

test('budget de pause épuisé : la déconnexion ne met plus en pause', () => {
  const c = clk.createClock({ ...opts, pauseBudgetMs: 5_000 });
  clk.startTurn(c, 0, 0);
  assert.equal(clk.pause(c, 1, 1_000), true);
  clk.resume(c, 10_000); // 9 s de pause, budget 5 s → débité à 0, échéance +5 s
  assert.equal(c.pauseBudget[1], 0);
  assert.equal(clk.pause(c, 1, 20_000), false, 'budget épuisé → pas de nouvelle pause');
});

test('commitMove : le temps de pause ne consomme pas la réserve', () => {
  const c = clk.createClock(opts);
  clk.startTurn(c, 0, 0);
  clk.pause(c, 1, 2_000);
  clk.resume(c, 12_000); // 10 s de pause
  // Coup joué à t=35s : actif = 35 - 10 (pause) = 25 s → 5 s au-delà de base.
  clk.commitMove(c, 35_000);
  assert.equal(c.reserve[0], 120_000 - 5_000);
});

test('isExpired : vrai seulement échéance atteinte hors pause', () => {
  const c = clk.createClock({ ...opts, reserveMs: 0 });
  clk.startTurn(c, 0, 0); // échéance = 20 s
  assert.equal(clk.isExpired(c, 19_000), false);
  assert.equal(clk.isExpired(c, 21_000), true);
  clk.pause(c, 1, 21_500);
  assert.equal(clk.isExpired(c, 30_000), false, 'jamais expiré en pause');
});

test('recordTimeout : forfait au 3ᵉ coup automatique', () => {
  const c = clk.createClock(opts);
  assert.equal(clk.recordTimeout(c, 0), false);
  assert.equal(clk.recordTimeout(c, 0), false);
  assert.equal(clk.recordTimeout(c, 0), true);
  assert.equal(c.timeouts[0], 3);
});
