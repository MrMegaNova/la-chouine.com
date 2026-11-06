import { describe, expect, it } from 'vitest';
import { cuesBetween, type TableSnapshot } from './transitions';

const base: TableSnapshot = { handNo: 1, phase: 'draw', trickLength: 0, stock: 21, announceKey: null, matchWinner: null };
const at = (patch: Partial<TableSnapshot>): TableSnapshot => ({ ...base, ...patch });
const sounds = (prev: TableSnapshot | null, next: TableSnapshot, me = 0, humans = false) =>
  cuesBetween(prev, next, me, humans).map(c => c.sound);

describe('sons de la table (#155)', () => {
  it('rien au premier affichage (table ouverte ou rechargée)', () => {
    expect(sounds(null, base)).toEqual([]);
  });

  it('donne : à la fin de la coupe et à chaque nouvelle main', () => {
    expect(sounds(at({ phase: 'cutReveal' }), base)).toEqual(['deal']);
    expect(sounds(at({ handNo: 1, phase: 'final', stock: 0 }), at({ handNo: 2 }))).toEqual(['deal']);
    expect(sounds(at({ phase: 'cut' }), at({ phase: 'cutReveal' }))).toEqual([]);
  });

  it('carte posée : un son par carte, décalés si plusieurs arrivent ensemble', () => {
    expect(sounds(base, at({ trickLength: 1 }))).toEqual(['play']);
    const cues = cuesBetween(base, at({ trickLength: 2 }), 0, false);
    expect(cues.map(c => c.sound)).toEqual(['play', 'play']);
    expect(cues[1].delay).toBeGreaterThan(cues[0].delay);
  });

  it('pli ramassé puis pioche des deux joueurs', () => {
    expect(sounds(at({ trickLength: 2 }), at({ trickLength: 0, stock: 19 }))).toEqual(['collect', 'draw', 'draw']);
    // Talon épuisé : plus de pioche.
    expect(sounds(at({ trickLength: 2, phase: 'final', stock: 0 }), at({ trickLength: 0, phase: 'final', stock: 0 }))).toEqual(['collect']);
  });

  it('une nouvelle main ne déclenche ni pli ni pioche', () => {
    expect(sounds(at({ trickLength: 2, stock: 0, phase: 'final' }), at({ handNo: 2, trickLength: 0, stock: 21 }))).toEqual(['deal']);
  });

  it('annonce : une fois par annonce', () => {
    expect(sounds(base, at({ announceKey: '1|0|mariage-coeur' }))).toEqual(['announce']);
    expect(sounds(at({ announceKey: '1|0|mariage-coeur' }), at({ announceKey: '1|0|mariage-coeur', trickLength: 1 }))).toEqual(['play']);
  });

  it('fin de match : victoire ou défaite selon le siège du joueur', () => {
    expect(sounds(base, at({ matchWinner: 0 }), 0)).toEqual(['win']);
    expect(sounds(base, at({ matchWinner: 1 }), 0)).toEqual(['lose']);
    expect(sounds(base, at({ matchWinner: 0 }), 1)).toEqual(['lose']);
    // Déjà connu : pas de répétition.
    expect(sounds(at({ matchWinner: 0 }), at({ matchWinner: 0 }), 0)).toEqual([]);
    // Partie entre humains sur un même appareil : on fête le gagnant.
    expect(sounds(base, at({ matchWinner: 1 }), 0, true)).toEqual(['win']);
  });
});
