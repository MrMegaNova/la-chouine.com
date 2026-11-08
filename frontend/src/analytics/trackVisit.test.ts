import { describe, expect, it } from 'vitest';
import { campaignSource, trackingRefused, withoutCampaign } from './trackVisit';

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

describe('campagne d’arrivée (#290)', () => {
  it('lit ?src= puis utm_source, en minuscules', () => {
    expect(campaignSource('?src=Affiche')).toBe('affiche');
    expect(campaignSource('?utm_source=facebook&x=1')).toBe('facebook');
    expect(campaignSource('?src=flyer-a5&utm_source=facebook')).toBe('flyer-a5');
  });

  it('ignore les valeurs vides ou douteuses', () => {
    expect(campaignSource('')).toBeUndefined();
    expect(campaignSource('?src=')).toBeUndefined();
    expect(campaignSource('?src=<script>')).toBeUndefined();
    expect(campaignSource(`?src=${'a'.repeat(41)}`)).toBeUndefined();
  });

  it('retire les paramètres de campagne de l’adresse, et rien d’autre', () => {
    expect(withoutCampaign('https://la-chouine.com/?src=affiche')).toBe('/');
    expect(withoutCampaign('https://la-chouine.com/regles?utm_source=fb&a=1#x')).toBe('/regles?a=1#x');
    expect(withoutCampaign('https://la-chouine.com/jouer?a=1')).toBeNull();
  });
});
