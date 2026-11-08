import { describe, expect, it, vi } from 'vitest';
import type { SaveGamePayload } from '@/api/client';
import {
  GUEST_MATCH_MAX, GUEST_MATCH_TTL_MS, flushGuestMatches, keepGuestMatch, pendingGuestMatches,
} from './guestMatches';

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    data,
  };
}

const payload = (score = 3): SaveGamePayload => ({
  mode: 'ai', variant: 'classic', playerCount: 2, targetScore: 3, difficulty: 'normal', durationSec: 600,
  players: [
    { userId: null, guestName: 'Vous', score, won: score >= 3 },
    { userId: null, guestName: 'Ordinateur', score: 1, won: false },
  ],
});

describe('parties jouées sans compte (#290)', () => {
  it('garde les parties, au plus les plus récentes, et oublie les trop anciennes', () => {
    const store = memoryStore();
    const t0 = 1_000_000;
    keepGuestMatch(payload(), t0, store);
    expect(pendingGuestMatches(t0, store)).toHaveLength(1);
    expect(pendingGuestMatches(t0 + GUEST_MATCH_TTL_MS, store)).toHaveLength(0);

    for (let i = 0; i < GUEST_MATCH_MAX + 3; i++) keepGuestMatch(payload(), t0 + i, store);
    const kept = pendingGuestMatches(t0 + 100, store);
    expect(kept).toHaveLength(GUEST_MATCH_MAX);
    expect(kept[kept.length - 1].endedAt).toBe(t0 + GUEST_MATCH_MAX + 2);
  });

  it('ignore un stockage illisible', () => {
    const store = memoryStore();
    store.setItem('chouine-guest-matches', '{pas du json');
    expect(pendingGuestMatches(Date.now(), store)).toEqual([]);
  });

  it('envoie les parties sur le compte connecté, siège 0 rattaché au joueur', async () => {
    const store = memoryStore();
    keepGuestMatch(payload(), 10, store);
    keepGuestMatch(payload(2), 20, store);
    const save = vi.fn().mockResolvedValue({ ok: true, status: 201, data: { id: 'g' } });

    expect(await flushGuestMatches('tok', 'u1', save, store, 30)).toBe(2);
    expect(save).toHaveBeenCalledTimes(2);
    const [sent, token] = save.mock.calls[0];
    expect(token).toBe('tok');
    expect(sent.players[0]).toEqual({ userId: 'u1', guestName: null, score: 3, won: true });
    expect(sent.players[1]).toEqual({ userId: null, guestName: 'Ordinateur', score: 1, won: false });
    expect(pendingGuestMatches(30, store)).toEqual([]);
  });

  it('garde la partie si le serveur ou la session échoue, l’abandonne si elle est refusée', async () => {
    const store = memoryStore();
    keepGuestMatch(payload(), 10, store);
    keepGuestMatch(payload(), 11, store);
    keepGuestMatch(payload(), 12, store);
    const save = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 0, data: {} })
      .mockResolvedValueOnce({ ok: false, status: 401, data: {} })
      .mockResolvedValueOnce({ ok: false, status: 422, data: {} });

    expect(await flushGuestMatches('tok', 'u1', save, store, 20)).toBe(0);
    expect(pendingGuestMatches(20, store).map(m => m.endedAt)).toEqual([10, 11]);
  });

  it('deux envois simultanés n’enregistrent la partie qu’une fois', async () => {
    const store = memoryStore();
    keepGuestMatch(payload(), 10, store);
    const save = vi.fn().mockResolvedValue({ ok: true, status: 201, data: {} });
    const [a, b] = await Promise.all([
      flushGuestMatches('tok', 'u1', save, store, 20),
      flushGuestMatches('tok', 'u1', save, store, 20),
    ]);
    expect(save).toHaveBeenCalledTimes(1);
    expect([a, b]).toEqual([1, 1]);
  });
});
