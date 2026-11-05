import { describe, expect, it } from 'vitest';
import { displayInviteUrl, invitePath, isInviteCode } from './invitation';

describe('codes d’invitation (#306)', () => {
  it('accepte le format court, en minuscules ou majuscules, et l’ancien format', () => {
    expect(isInviteCode('k7m3qx')).toBe(true);
    expect(isInviteCode('K7M3QX')).toBe(true);
    expect(isInviteCode('a'.repeat(32))).toBe(true);
  });

  it('refuse les caractères ambigus et les longueurs inattendues', () => {
    for (const bad of ['k7m3q0', 'k7m3ql', 'k7m3qi', 'k7m3qo', 'k7m3q1', 'k7m3q', 'k7m3qxx', '', 'a'.repeat(31)]) {
      expect(isInviteCode(bad)).toBe(false);
    }
  });

  it('construit le chemin court et affiche le lien sans protocole', () => {
    expect(invitePath('k7m3qx')).toBe('/i/k7m3qx');
    expect(displayInviteUrl('https://la-chouine.com/i/k7m3qx')).toBe('la-chouine.com/i/k7m3qx');
    expect(displayInviteUrl('http://localhost:5173/i/k7m3qx')).toBe('localhost:5173/i/k7m3qx');
  });
});
