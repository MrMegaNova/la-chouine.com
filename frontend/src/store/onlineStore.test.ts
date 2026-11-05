// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/api/client', () => ({
  authApi: {},
  usersApi: {},
  friendsApi: { requests: vi.fn() },
  onlineApi: { wsTicket: vi.fn() },
}));

import { onlineApi } from '@/api/client';
import { useAuthStore } from '@/store/authStore';
import { useOnlineStore } from '@/store/onlineStore';

const mocked = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  close = vi.fn();
  send = vi.fn();
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
}

async function openSocket() {
  useOnlineStore.getState().connectPresence('tok');
  await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  FakeWebSocket.instances = [];
  mocked(onlineApi.wsTicket).mockReset();
  mocked(onlineApi.wsTicket).mockResolvedValue({ ok: true, status: 200, data: { ticket: 'tick' } });
  useAuthStore.setState({ token: 'tok', user: null });
  useOnlineStore.setState({ status: 'idle', error: null, game: null });
});

afterEach(() => {
  useOnlineStore.getState().forgetSession();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('onlineStore : compte supprimé (#238)', () => {
  it('fermeture 4003 : déconnexion, sans aucune reconnexion, même en pleine partie', async () => {
    const ws = await openSocket();
    useOnlineStore.setState({ status: 'playing' });

    ws.onclose?.({ code: 4003 });
    expect(useAuthStore.getState().token).toBeNull();
    expect(useOnlineStore.getState().status).toBe('idle');
    expect(useOnlineStore.getState().reconnecting).toBe(false);

    const calls = mocked(onlineApi.wsTicket).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocked(onlineApi.wsTicket).mock.calls.length).toBe(calls);
  });

  it('une autre fermeture en partie relance bien la reprise', async () => {
    const ws = await openSocket();
    useOnlineStore.setState({ status: 'playing' });

    ws.onclose?.({ code: 1006 });
    expect(useAuthStore.getState().token).toBe('tok');
    expect(useOnlineStore.getState().reconnecting).toBe(true);
  });

  it('forgetSession ferme le socket quel que soit l’état', async () => {
    const ws = await openSocket();
    useOnlineStore.setState({ status: 'over' });

    useOnlineStore.getState().forgetSession();
    expect(ws.close).toHaveBeenCalled();
    expect(ws.onclose).toBeNull();
    expect(useOnlineStore.getState().status).toBe('idle');
  });
});

// Instantané produit par le GameSession du serveur après une coupe sans pioche.
const CANCELLED_SNAPSHOT = {"sessionId":"t","you":0,"variant":"classic","target":3,"rated":true,"names":["Alice","Bob"],"scores":[0,0],"trump":null,"turnUp":null,"talonCount":0,"trick":[],"leader":0,"turn":0,"phase":"cut","handOver":false,"handNo":0,"cut":{"picks":[null,null],"deadline":null,"deckCount":32},"lastTrick":null,"opponentLastTrick":null,"clock":{"seat":null,"remainingMs":null,"paused":false,"baseMs":20000,"reserveMs":[120000,120000],"timeouts":[0,0]},"lastExchange":null,"lastAnnounce":null,"lastHandResult":null,"finished":true,"matchResult":{"winnerSeat":null,"scores":[0,0],"cancelled":{"reason":"cut-timeout"}},"players":[{"seat":0,"id":"u1","handCount":0,"annonce":0,"wonCount":0,"hand":[],"won":[],"legalMoves":[]},{"seat":1,"id":"u2","handCount":0,"annonce":0,"wonCount":0}]};

describe('onlineStore : match annulé (#228)', () => {
  it('un état annulé termine la partie, sans forfait', async () => {
    const ws = await openSocket();
    useOnlineStore.setState({ status: 'playing' });

    ws.onmessage?.({ data: JSON.stringify({ t: 'state', state: CANCELLED_SNAPSHOT }) });
    const st = useOnlineStore.getState();
    expect(st.status).toBe('over');
    expect(st.cancelled).toBe(true);
    expect(st.forfeit).toBeNull();
  });
});
