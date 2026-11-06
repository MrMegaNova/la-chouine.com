import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSoundStore } from '@/store/soundStore';
import { playSound, preloadSounds, unlockAudio } from './sounds';

afterEach(() => {
  vi.unstubAllGlobals();
  useSoundStore.setState({ muted: false });
});

describe('moteur audio (#155)', () => {
  it('sans Web Audio (serveur, vieux navigateur) : silence, sans erreur', () => {
    expect(() => { unlockAudio(); preloadSounds(); playSound('play'); playSound('win', 10); }).not.toThrow();
  });

  it('son coupé : aucun contexte audio n’est créé', () => {
    const AudioContext = vi.fn();
    vi.stubGlobal('window', { AudioContext });
    useSoundStore.setState({ muted: true });
    unlockAudio();
    playSound('deal');
    expect(AudioContext).not.toHaveBeenCalled();
  });
});
