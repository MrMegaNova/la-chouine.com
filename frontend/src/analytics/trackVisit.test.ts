import { describe, expect, it } from 'vitest';
import { trackingRefused } from './trackVisit';

describe('refus de la mesure d’audience (#311)', () => {
  const nav = (props: Record<string, unknown>) => props as unknown as Navigator;

  it('respecte Do Not Track et Global Privacy Control', () => {
    expect(trackingRefused(nav({ doNotTrack: '1' }))).toBe(true);
    expect(trackingRefused(nav({ globalPrivacyControl: true }))).toBe(true);
    expect(trackingRefused(nav({ msDoNotTrack: '1' }))).toBe(true);
  });

  it('mesure par défaut', () => {
    expect(trackingRefused(nav({ doNotTrack: null }))).toBe(false);
    expect(trackingRefused(nav({ doNotTrack: '0', globalPrivacyControl: false }))).toBe(false);
  });
});
