import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Effets sonores (#155) : activés par défaut, coupables depuis la table de jeu.
// Le choix est mémorisé dans le navigateur.
interface SoundState {
  muted: boolean;
  toggleMuted: () => void;
}

export const useSoundStore = create<SoundState>()(
  persist(
    (set) => ({
      muted: false,
      toggleMuted: () => set(s => ({ muted: !s.muted })),
    }),
    { name: 'chouine-sound' },
  ),
);
