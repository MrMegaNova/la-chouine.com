import { describe, expect, it } from 'vitest';
import { niceMax, shortDay } from './scale';

describe('échelles du tableau de bord (#311)', () => {
  it('arrondit le haut de l’axe', () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(3)).toBe(4);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(12)).toBe(20);
    expect(niceMax(23)).toBe(25);
    expect(niceMax(480)).toBe(500);
    expect(niceMax(1000)).toBe(1000);
  });

  it('formate les jours', () => {
    expect(shortDay('2026-11-06')).toBe('06/11');
  });
});
