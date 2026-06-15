'use strict';

// Parité moteur TS/JS (#128) — côté backend (engine.js).
// Les mêmes fixtures versionnées (shared/engine-parity/fixtures.json) sont
// exécutées ici par node:test et côté frontend par vitest. Les deux moteurs
// doivent produire EXACTEMENT le résultat attendu : une divergence de règle
// casse la CI des deux côtés. → voir aussi l'agent `engine-parity`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const engine = require('../src/game/engine');
const { runCase } = require('../../shared/engine-parity/runner');
const fixtures = require(path.join(__dirname, '../../shared/engine-parity/fixtures.json'));

for (const [group, cases] of Object.entries(fixtures)) {
  if (!Array.isArray(cases)) continue; // ignore les clés de doc (_comment)
  for (const fx of cases) {
    test(`parité moteur · ${group} · ${fx.name}`, () => {
      assert.deepEqual(runCase(engine, fx), fx.expect);
    });
  }
}
