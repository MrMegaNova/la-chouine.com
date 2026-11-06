import { describe, expect, it } from 'vitest';
import { getLegalMoves } from '@/game/engine';
import type { Card, GameState } from '@/game/types';
import { DEMO_OBLIGATIONS, DEMO_PIOCHE, DEMO_SEPT, type Demo, type DemoStep } from './demos';

// Les démonstrations de la page Règles (#70) ne doivent jamais enseigner une
// règle fausse : les cartes montrées comme jouables sont celles du moteur.
const DEMOS: Demo[] = [DEMO_PIOCHE, DEMO_OBLIGATIONS, DEMO_SEPT];
const key = (cards: Card[]) => cards.map(c => `${c.r}${c.s}`).sort();

function legalFromEngine(step: DemoStep): Card[] {
  // Léa = siège 1, Marc = siège 0. Seuls la main, le pli, la phase et l'atout
  // comptent pour getLegalMoves.
  const state = {
    phase: step.talon > 0 ? 'draw' : 'final',
    trump: step.trump,
    trick: step.trick.map(t => ({ p: t.by === 'opp' ? 0 : 1, card: t.card })),
    players: [{ hand: [] }, { hand: step.hand }],
  } as unknown as GameState;
  return getLegalMoves(state, 1);
}

describe('démonstrations des règles (#70)', () => {
  for (const demo of DEMOS) {
    describe(demo.id, () => {
      it('chaque surlignage correspond aux coups autorisés par le moteur', () => {
        const checked = demo.steps.filter(s => s.legal);
        expect(checked.length).toBeGreaterThan(0);
        for (const step of checked) expect(key(step.legal!), step.caption).toEqual(key(legalFromEngine(step)));
      });

      it('les cartes sont cohérentes d’une étape à l’autre', () => {
        for (const step of demo.steps) {
          const all = [...step.hand, ...step.trick.map(t => t.card), ...(step.turnUp ? [step.turnUp] : [])];
          expect(new Set(key(all)).size, `doublon : ${step.caption}`).toBe(all.length);
          if (step.turnUp) expect(step.turnUp.s, 'la retourne fixe l’atout').toBe(step.trump);
          expect(step.hand.length).toBeLessThanOrEqual(5);
        }
      });
    });
  }

  it('le talon épuisé impose bien des obligations (garde-fou du test)', () => {
    const step = DEMO_OBLIGATIONS.steps[1];
    expect(key(legalFromEngine(step))).toEqual(key([{ s: 'coeur', r: 'A' }]));
  });
});
