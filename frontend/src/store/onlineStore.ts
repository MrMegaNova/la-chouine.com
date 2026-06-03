import { create } from 'zustand';
import type { Card, GameState, HandResult, Variant, Suit, TrickEntry } from '@/game/types';

// ─── Store PvP en ligne ───────────────────────────────────────────────────────
// Client WebSocket du matchmaking + de la partie. Reçoit du serveur des
// snapshots *filtrés* (notre main visible, l'adverse en décompte) qu'il mappe
// vers la forme `GameState` attendue par GameTable. Les coups sont envoyés au
// serveur (autoritatif) ; aucun moteur ne tourne ici.

export type OnlineStatus = 'idle' | 'searching' | 'found' | 'playing' | 'over' | 'error';

interface SnapshotPlayer {
  seat: number;
  handCount: number;
  annonce: number;
  wonCount: number;
  hand?: Card[];
}
interface ServerSnapshot {
  sessionId: string;
  you: number;
  variant: Variant;
  target: 3 | 5;
  names: string[];
  scores: number[];
  trump: Suit | null;
  turnUp: Card | null;
  talonCount: number;
  trick: TrickEntry[];
  leader: number;
  turn: number;
  phase: 'draw' | 'final';
  handOver: boolean;
  handNo: number;
  lastTrick: { winner: number } | null;
  lastHandResult: HandResult | null;
  finished: boolean;
  matchResult: { winnerSeat: number; scores: number[] } | null;
  players: SnapshotPlayer[];
}

interface OnlineState {
  status: OnlineStatus;
  variant: Variant;
  opponent: string | null;
  searchStartedAt: number | null;
  error: string | null;
  game: GameState | null;
  pendingResult: HandResult | null;
  toast: string | null;

  findOpponent: (variant: Variant, token: string) => void;
  cancelSearch: () => void;
  playCard: (seat: number, card: Card) => void;
  declareCombo: (seat: number, sig: string) => void;
  exchangeSeven: (seat: number) => void;
  nextHand: () => void;
  rematch: (token: string) => void;
  leave: () => void;
}

let ws: WebSocket | null = null;

function wsUrl(token: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`;
}

const placeholder = (): Card => ({ s: 'pique', r: '7' });

// Mappe un snapshot serveur vers la forme GameState consommée par GameTable.
// Les cartes des adversaires / talon ne sont que des emplacements (seul le
// décompte est connu ; GameTable n'utilise que leur longueur).
function mapSnapshot(s: ServerSnapshot): GameState {
  const n = s.players.length as 2 | 3 | 4;
  return {
    mode: 'online',
    variant: s.variant,
    playerCount: n,
    diff: 'normal',
    target: s.target,
    names: s.names,
    oppId: null,
    opts: { mode: 'online', variant: s.variant, playerCount: n, target: s.target, names: s.names },
    scores: s.scores,
    dealer: -1,
    handNo: s.handNo,
    lastHandDrawn: false,
    recorded: false,
    viewPlayer: s.you,
    gatePending: false,
    players: s.players.map((p, i) => ({
      hand: i === s.you ? (p.hand ?? []) : Array.from({ length: p.handCount }, placeholder),
      won: Array.from({ length: p.wonCount }, placeholder),
      declared: new Set<string>(),
      annonce: p.annonce,
    })),
    trump: s.trump,
    turnUp: s.turnUp,
    talon: Array.from({ length: Math.max(0, s.talonCount - (s.turnUp ? 1 : 0)) }, placeholder),
    trick: s.trick,
    leader: s.leader,
    turn: s.turn,
    phase: s.phase,
    handOver: s.handOver,
    lastTrickWinner: s.lastTrick ? s.lastTrick.winner : null,
    sevenAnnounced: false,
  };
}

function send(obj: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function closeSocket() {
  if (ws) {
    try { ws.onclose = null; ws.close(); } catch { /* ignore */ }
    ws = null;
  }
}

export const useOnlineStore = create<OnlineState>((set, get) => {
  function handleMessage(raw: string) {
    let msg: { t: string; [k: string]: unknown };
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.t) {
      case 'queue':
        if (msg.status === 'searching') set({ status: 'searching' });
        break;
      case 'matchFound':
        set({ status: 'found', opponent: (msg.opponent as string) ?? null });
        break;
      case 'state': {
        const snap = msg.state as ServerSnapshot;
        const game = mapSnapshot(snap);
        let pendingResult: HandResult | null = null;
        if (snap.handOver && snap.lastHandResult) pendingResult = snap.lastHandResult;
        set({
          game,
          pendingResult,
          status: snap.finished ? 'over' : 'playing',
          opponent: snap.names[1 - snap.you] ?? get().opponent,
        });
        break;
      }
      case 'error':
        set({ toast: (msg.error as string) ?? 'Erreur réseau.' });
        break;
    }
  }

  function ensureSocket(token: string, onOpen: () => void) {
    if (ws && ws.readyState === WebSocket.OPEN) { onOpen(); return; }
    closeSocket();
    ws = new WebSocket(wsUrl(token));
    ws.onopen = onOpen;
    ws.onmessage = (e) => handleMessage(typeof e.data === 'string' ? e.data : '');
    ws.onerror = () => set({ status: 'error', error: 'Connexion au serveur impossible.' });
    ws.onclose = () => {
      // Si on était en recherche/jeu, on signale la déconnexion.
      const st = get().status;
      if (st === 'searching' || st === 'playing' || st === 'found') {
        set({ status: 'error', error: 'Connexion perdue.' });
      }
    };
  }

  return {
    status: 'idle',
    variant: 'classic',
    opponent: null,
    searchStartedAt: null,
    error: null,
    game: null,
    pendingResult: null,
    toast: null,

    findOpponent: (variant, token) => {
      set({ status: 'searching', variant, opponent: null, error: null, game: null, pendingResult: null, searchStartedAt: Date.now() });
      ensureSocket(token, () => send({ t: 'queue', action: 'join', variant }));
    },

    cancelSearch: () => {
      send({ t: 'queue', action: 'leave' });
      closeSocket();
      set({ status: 'idle', searchStartedAt: null, opponent: null });
    },

    playCard: (_seat, card) => send({ t: 'action', action: { type: 'play', card: { s: card.s, r: card.r } } }),
    declareCombo: (_seat, sig) => send({ t: 'action', action: { type: 'declare', sig } }),
    exchangeSeven: () => send({ t: 'action', action: { type: 'exchangeSeven' } }),
    nextHand: () => send({ t: 'action', action: { type: 'nextHand' } }),

    rematch: (token) => {
      const variant = get().variant;
      set({ status: 'searching', opponent: null, game: null, pendingResult: null, error: null, searchStartedAt: Date.now() });
      ensureSocket(token, () => send({ t: 'queue', action: 'join', variant }));
    },

    leave: () => {
      send({ t: 'queue', action: 'leave' });
      closeSocket();
      set({ status: 'idle', game: null, pendingResult: null, opponent: null, searchStartedAt: null, error: null });
    },
  };
});
