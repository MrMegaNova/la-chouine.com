import { describe, it, expect } from 'vitest';
import * as engine from './engine';
import { runCase } from '../../../shared/engine-parity/runner.js';
import fixturesJson from '../../../shared/engine-parity/fixtures.json';

// Parité moteur TS/JS (#128) — côté frontend (engine.ts).
// Mêmes fixtures versionnées que la suite backend (node:test) ; les deux moteurs
// doivent produire EXACTEMENT le résultat attendu. Runner (CJS) et fixtures
// (JSON) sont partagés à la racine `shared/`. → agent `engine-parity`.

const fixtures = fixturesJson as unknown as Record<string, unknown>;

for (const [group, cases] of Object.entries(fixtures)) {
  if (!Array.isArray(cases)) continue; // ignore les clés de doc (_comment)
  describe(`parité moteur · ${group}`, () => {
    for (const fx of cases as Array<{ name: string; expect: unknown }>) {
      it(fx.name, () => {
        expect(runCase(engine, fx)).toEqual(fx.expect);
      });
    }
  });
}
