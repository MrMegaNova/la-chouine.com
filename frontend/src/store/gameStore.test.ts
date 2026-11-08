// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import { gamesApi } from '@/api/client';
import { pendingGuestMatches } from '@/game/guestMatches';
import type { GameState } from '@/game/types';

// Enregistrement de fin de match (#290) : une seule fois, sur le compte ou,
// sans compte, dans le navigateur.

function finish(scores: number[]) {
  useGameStore.getState().startGame({ mode: 'ai', variant: 'classic', playerCount: 2, target: 3, names: ['Moi', 'Ordinateur'] } as GameState['opts']);
  const game = useGameStore.getState().game!;
  useGameStore.setState({ game: { ...game, scores } });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('recordMatchEnd (#290)', () => {
  it('connecté : enregistre le match une seule fois', async () => {
    const save = vi.spyOn(gamesApi, 'save').mockResolvedValue({ ok: true, status: 201, data: { id: 'g' } });
    finish([3, 1]);
    await useGameStore.getState().recordMatchEnd('tok', 'u1');
    await useGameStore.getState().recordMatchEnd('tok', 'u1');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].players[0]).toMatchObject({ userId: 'u1', guestName: null, score: 3, won: true });
    useGameStore.getState().quitGame();
  });

  it('sans compte : garde le match dans le navigateur', async () => {
    const save = vi.spyOn(gamesApi, 'save');
    finish([1, 3]);
    await useGameStore.getState().recordMatchEnd(null, null);
    await useGameStore.getState().recordMatchEnd(null, null);
    expect(save).not.toHaveBeenCalled();
    const kept = pendingGuestMatches();
    expect(kept).toHaveLength(1);
    expect(kept[0].payload.players[0]).toMatchObject({ userId: null, guestName: 'Moi', score: 1, won: false });
    useGameStore.getState().quitGame();
  });

  it('match pas terminé : rien n’est enregistré', async () => {
    const save = vi.spyOn(gamesApi, 'save');
    finish([2, 1]);
    await useGameStore.getState().recordMatchEnd(null, null);
    expect(save).not.toHaveBeenCalled();
    expect(pendingGuestMatches()).toHaveLength(0);
    useGameStore.getState().quitGame();
  });
});
