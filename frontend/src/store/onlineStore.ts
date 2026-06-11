import { create } from 'zustand';
import { useNotificationStore } from '@/store/notificationStore';
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
  matchResult: {
    winnerSeat: number;
    scores: number[];
    forfeit?: { by: number; reason: 'abandon' | 'timeout' };
  } | null;
  players: SnapshotPlayer[];
}

export interface ForfeitInfo {
  by: number;                      // siège de l'abandonnant
  reason: 'abandon' | 'timeout';
  youWin: boolean;
}

export interface Presence {
  online: number;
  inQueue: number;
  inGame: number;
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
  // Abandon / reconnexion (#30)
  opponentDisconnected: boolean;
  opponentDeadline: number | null; // échéance (ms epoch) avant forfait adverse
  reconnecting: boolean;           // notre propre connexion est en cours de reprise
  forfeit: ForfeitInfo | null;     // issue du match si terminé par forfait
  // Présence (#43)
  presence: Presence | null;       // compteurs poussés par le serveur

  connectPresence: (token: string) => void;
  disconnectPresence: () => void;
  findOpponent: (variant: Variant, token: string) => void;
  cancelSearch: () => void;
  playCard: (seat: number, card: Card) => void;
  declareCombo: (seat: number, sig: string) => void;
  exchangeSeven: (seat: number) => void;
  nextHand: () => void;
  rematch: (token: string) => void;
  forfeitGame: () => void;
  leave: () => void;
}

let ws: WebSocket | null = null;
let lastToken: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const RECONNECT_DELAY_MS = 2000;
const RECONNECT_MAX = 14; // ~28 s d'essais, sous le délai de grâce serveur (60 s)

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
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempts = 0;
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
      case 'hello':
        // Reconnexion alors que la partie s'est terminée pendant notre absence
        // (forfait déjà prononcé côté serveur) : inutile d'attendre un état.
        if (msg.inSession === false && get().status === 'playing') {
          set({
            status: 'error',
            error: 'La partie s’est terminée pendant votre déconnexion (forfait).',
            opponentDisconnected: false, opponentDeadline: null,
          });
        }
        break;
      case 'queue':
        if (msg.status === 'searching') set({ status: 'searching' });
        break;
      case 'matchFound':
        set({ status: 'found', opponent: (msg.opponent as string) ?? null });
        break;
      case 'presence':
        set({
          presence: {
            online: (msg.online as number) ?? 0,
            inQueue: (msg.inQueue as number) ?? 0,
            inGame: (msg.inGame as number) ?? 0,
          },
        });
        break;
      case 'state': {
        const snap = msg.state as ServerSnapshot;
        // Hors partie (connexion de présence) : un état *terminé* est un écho
        // de fin de match après leave() → à ignorer. Un état *en cours* est une
        // reprise (partie retrouvée après rechargement de la page) → on rentre.
        if (get().status === 'idle' && snap.finished) break;
        const game = mapSnapshot(snap);
        let pendingResult: HandResult | null = null;
        if (snap.handOver && snap.lastHandResult) pendingResult = snap.lastHandResult;
        const mr = snap.matchResult;
        const forfeit: ForfeitInfo | null = snap.finished && mr?.forfeit
          ? { by: mr.forfeit.by, reason: mr.forfeit.reason, youWin: mr.winnerSeat === snap.you }
          : null;
        set({
          game,
          pendingResult,
          forfeit,
          status: snap.finished ? 'over' : 'playing',
          opponent: snap.names[1 - snap.you] ?? get().opponent,
          // Un match clos (forfait compris) efface l'alerte de déconnexion adverse.
          ...(snap.finished ? { opponentDisconnected: false, opponentDeadline: null } : {}),
        });
        break;
      }
      case 'notification':
        // Reçues sur le socket de présence (#43) ; routage par `kind` (#44).
        if (msg.kind === 'friendRequest') {
          useNotificationStore.getState().onFriendRequest((msg.from as string) ?? 'Un joueur');
        }
        break;
      case 'opponentDisconnected':
        set({ opponentDisconnected: true, opponentDeadline: (msg.deadline as number) ?? null });
        break;
      case 'opponentReconnected':
        set({ opponentDisconnected: false, opponentDeadline: null });
        break;
      case 'error':
        set({ toast: (msg.error as string) ?? 'Erreur réseau.' });
        break;
    }
  }

  // Reprise de NOTRE connexion : le serveur accorde un délai de grâce avant
  // forfait ; on retente donc en boucle (le serveur repousse l'état complet à
  // la reconnexion). Au-delà de RECONNECT_MAX, on abandonne et on l'affiche.
  function tryReconnect() {
    if (!lastToken || reconnectAttempts >= RECONNECT_MAX) {
      set({ reconnecting: false, status: 'error', error: 'Connexion perdue.' });
      return;
    }
    reconnectAttempts++;
    set({ reconnecting: true });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      ensureSocket(lastToken!, () => {
        reconnectAttempts = 0;
        set({ reconnecting: false });
      });
    }, RECONNECT_DELAY_MS);
  }

  function ensureSocket(token: string, onOpen: () => void) {
    lastToken = token;
    if (ws && ws.readyState === WebSocket.OPEN) { onOpen(); return; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { try { ws.onclose = null; ws.close(); } catch { /* ignore */ } }
    ws = new WebSocket(wsUrl(token));
    ws.onopen = onOpen;
    ws.onmessage = (e) => handleMessage(typeof e.data === 'string' ? e.data : '');
    // onclose est l'unique point de décision (onerror est toujours suivi de onclose).
    ws.onclose = () => {
      ws = null;
      set({ presence: null }); // chiffres périmés dès qu'on est déconnecté
      const st = get().status;
      if (st === 'playing' || st === 'found') {
        tryReconnect(); // partie en cours : le délai de grâce nous couvre
      } else if (st === 'searching') {
        set({ status: 'error', error: 'Connexion perdue.' });
      } else {
        // Connexion de présence : reprise silencieuse, sans urgence.
        if (lastToken) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (get().status === 'idle' && lastToken) ensureSocket(lastToken, () => {});
          }, 30000);
        }
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
    opponentDisconnected: false,
    opponentDeadline: null,
    reconnecting: false,
    forfeit: null,
    presence: null,

    // Présence : socket ouvert dès la connexion de l'utilisateur (#43). Sert
    // aussi de canal de reprise si une partie était en cours (le serveur
    // repousse l'état à la connexion).
    connectPresence: (token) => {
      ensureSocket(token, () => {});
    },

    // À la déconnexion de l'utilisateur — ne touche jamais à une partie en cours.
    disconnectPresence: () => {
      if (get().status !== 'idle') return;
      lastToken = null;
      closeSocket();
      set({ presence: null });
    },

    findOpponent: (variant, token) => {
      set({
        status: 'searching', variant, opponent: null, error: null, game: null,
        pendingResult: null, searchStartedAt: Date.now(),
        opponentDisconnected: false, opponentDeadline: null, reconnecting: false, forfeit: null,
      });
      ensureSocket(token, () => send({ t: 'queue', action: 'join', variant }));
    },

    // NB : depuis #43, annuler/quitter ne ferme plus le socket — il reste la
    // connexion de présence (et le canal de reprise) tant qu'on est connecté.
    cancelSearch: () => {
      send({ t: 'queue', action: 'leave' });
      set({ status: 'idle', searchStartedAt: null, opponent: null });
    },

    playCard: (_seat, card) => send({ t: 'action', action: { type: 'play', card: { s: card.s, r: card.r } } }),
    declareCombo: (_seat, sig) => send({ t: 'action', action: { type: 'declare', sig } }),
    exchangeSeven: () => send({ t: 'action', action: { type: 'exchangeSeven' } }),
    nextHand: () => send({ t: 'action', action: { type: 'nextHand' } }),

    rematch: (token) => {
      const variant = get().variant;
      set({
        status: 'searching', opponent: null, game: null, pendingResult: null, error: null,
        searchStartedAt: Date.now(),
        opponentDisconnected: false, opponentDeadline: null, reconnecting: false, forfeit: null,
      });
      ensureSocket(token, () => send({ t: 'queue', action: 'join', variant }));
    },

    // Abandon volontaire : le serveur clôt le match (victoire adverse) et
    // renverra l'état final ; l'appelant décide ensuite de quitter ou non.
    forfeitGame: () => send({ t: 'action', action: { type: 'forfeit' } }),

    leave: () => {
      send({ t: 'queue', action: 'leave' });
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      reconnectAttempts = 0;
      set({
        status: 'idle', game: null, pendingResult: null, opponent: null,
        searchStartedAt: null, error: null,
        opponentDisconnected: false, opponentDeadline: null, reconnecting: false, forfeit: null,
      });
      // Le socket reste ouvert (présence) ; s'il était tombé, on le relance.
      if (lastToken) ensureSocket(lastToken, () => {});
    },
  };
});
