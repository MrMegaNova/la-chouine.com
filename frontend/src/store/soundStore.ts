import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Réglages audio (#155) — muet et volume, persistés en localStorage.
interface SoundState {
  muted: boolean;
  volume: number; // 0..1
  toggleMuted: () => void;
  setVolume: (v: number) => void;
}

export const useSoundStore = create<SoundState>()(
  persist(
    (set) => ({
      muted: false,
      volume: 0.6,
      toggleMuted: () => set((s) => ({ muted: !s.muted })),
      setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)) }),
    }),
    { name: 'chouine-sound' }
  )
);
