'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Matchmaker } = require('../src/realtime/matchmaking');

const mk = () => new Matchmaker(); // 50 / +25 par 3s / fallback 30s

test('apparie immédiatement deux joueurs d’Elo proche', () => {
  const m = mk();
  m.join({ userId: 'a', name: 'A', rating: 1500, variant: 'classic' }, 0);
  m.join({ userId: 'b', name: 'B', rating: 1530, variant: 'classic' }, 0);
  const pairs = m.findMatches(0);
  assert.equal(pairs.length, 1);
  assert.equal(m.size('classic'), 0);
});

test('n’apparie pas deux Elo éloignés au départ, mais le fait après le délai de repli', () => {
  const m = mk();
  m.join({ userId: 'a', name: 'A', rating: 1500, variant: 'classic' }, 0);
  m.join({ userId: 'b', name: 'B', rating: 2000, variant: 'classic' }, 0);
  assert.equal(m.findMatches(0).length, 0);          // écart 500 > 50
  assert.equal(m.findMatches(30000).length, 1);      // fenêtre infinie au repli
});

test('la fenêtre s’élargit avec le temps d’attente', () => {
  const m = mk();
  m.join({ userId: 'a', name: 'A', rating: 1500, variant: 'classic' }, 0);
  m.join({ userId: 'b', name: 'B', rating: 1620, variant: 'classic' }, 0); // écart 120
  assert.equal(m.findMatches(6000).length, 0);   // 2 pas → fenêtre 100 < 120
  assert.equal(m.findMatches(9000).length, 1);   // 3 pas → fenêtre 125 ≥ 120
});

test('un joueur n’a qu’un ticket : rejoindre une autre variante déplace le ticket', () => {
  const m = mk();
  m.join({ userId: 'a', name: 'A', rating: 1500, variant: 'classic' }, 0);
  m.join({ userId: 'a', name: 'A', rating: 1500, variant: 'mondoubleau' }, 0);
  assert.equal(m.size('classic'), 0);
  assert.equal(m.size('mondoubleau'), 1);
  assert.equal(m.has('a'), true);
});

test('les files de variantes différentes ne se mélangent pas', () => {
  const m = mk();
  m.join({ userId: 'a', name: 'A', rating: 1500, variant: 'classic' }, 0);
  m.join({ userId: 'b', name: 'B', rating: 1500, variant: 'mondoubleau' }, 0);
  assert.equal(m.findMatches(0).length, 0);
});

test('avec trois joueurs, les deux plus proches sont appariés, le troisième reste', () => {
  const m = mk();
  m.join({ userId: 'a', name: 'A', rating: 1500, variant: 'classic' }, 0);
  m.join({ userId: 'b', name: 'B', rating: 1510, variant: 'classic' }, 0);
  m.join({ userId: 'c', name: 'C', rating: 1520, variant: 'classic' }, 0);
  const pairs = m.findMatches(0);
  assert.equal(pairs.length, 1);
  assert.equal(m.size('classic'), 1); // un joueur reste en file
});

test('leave retire le joueur de la file', () => {
  const m = mk();
  m.join({ userId: 'a', name: 'A', rating: 1500, variant: 'classic' }, 0);
  assert.equal(m.leave('a'), true);
  assert.equal(m.size('classic'), 0);
  assert.equal(m.leave('a'), false);
});
