import { create } from 'zustand';
import {
  createGame, dealHand, applyPlayCard, applyResolveTrick,
  applyDeclareCombo, applyExchangeSeven, computeHandResult,
  applyHandResult, getAvailableCombos, getLegalMoves, shouldAnnounceAuSept,

} from '@/game/engine';
import { aiChooseLead, aiChooseResponse, aiChooseCombos } from '@/game/ai';
import { SUIT_SYMBOL } from '@/game/constants';
import { gamesApi } from '@/api/client';
import type { GameState, GameOpts, Card, HandResult } from '@/game/types';

interface GameStore {
  game: GameState | null;
  pendingResult: HandResult | null;
  toast: string | null;

  startGame: (opts: GameOpts) => void;
  newHand: () => void;
  playCard: (seat: number, card: Card) => void;
  declareCombo: (seat: number, sig: string) => void;
  exchangeSeven: (seat: number) => void;
  quitGame: () => void;
  revealForPlayer: (seat: number) => void;
  clearPendingResult: () => void;
  clearToast: () => void;
  saveMatchResult: (token: string | null, userId: string | null) => Promise<void>;
}

let aiTimer: ReturnType<typeof setTimeout> | null = null;

function clearAiTimer() {
  if (aiTimer != null) { clearTimeout(aiTimer); aiTimer = null; }
}

export const useGameStore = create<GameStore>((set, get) => ({
  game: null,
  pendingResult: null,
  toast: null,

  startGame: (opts) => {
    clearAiTimer();
    const base = createGame(opts);
    const game = dealHand(base);
    const toastMsg = buildDealToast(game);
    set({ game, pendingResult: null, toast: toastMsg });
    scheduleAiIfNeeded(game);
  },

  newHand: () => {
    const { game } = get();
    if (!game) return;
    clearAiTimer();
    const next = dealHand(game);
    const toastMsg = buildDealToast(next);
    set({ game: next, pendingResult: null, toast: toastMsg });
    scheduleAiIfNeeded(next);
  },

  playCard: (seat, card) => {
    const { game } = get();
    if (!game || game.handOver || game.gatePending) return;
    if (game.turn !== seat) return;
    const legal = getLegalMoves(game, seat);
    if (!legal.includes(card)) return;

    let next = applyPlayCard(game, seat, card);

    if (next.trick.length === next.playerCount) {
      set({ game: next });
      // Résoudre le pli après un délai pour l'animation
      aiTimer = setTimeout(() => {
        const { game: current } = get();
        if (!current) return;
        const resolved = applyResolveTrick(current);
        if (resolved.players.some(p => p.hand.length === 0)) {
          endCurrentHand(resolved);
        } else {
          checkAuSept(resolved);
        }
      }, 680);
    } else {
      set({ game: next });
      scheduleAiIfNeeded(next);
    }
  },

  declareCombo: (seat, sig) => {
    const { game } = get();
    if (!game || game.handOver) return;
    const combo = getAvailableCombos(game, seat).find(c => c.sig === sig);
    if (!combo) return;

    if (combo.type === 'chouine') {
      const result = computeHandResult(game, seat);
      const next = applyHandResult(game, result);
      set({ game: next, pendingResult: result, toast: `${game.names[seat]} réalise une CHOUINE !` });
      return;
    }

    const next = applyDeclareCombo(game, seat, combo);
    const toastMsg = combo.setsTrump && combo.suit
      ? `${game.names[seat]} → ${combo.label} +${combo.value} · Atout : ${getSuitSymbol(combo.suit)}`
      : `${game.names[seat]} annonce ${combo.label}  +${combo.value}`;
    set({ game: next, toast: toastMsg });
  },

  exchangeSeven: (seat) => {
    const { game } = get();
    if (!game) return;
    const next = applyExchangeSeven(game, seat);
    if (next !== game) {
      set({ game: next, toast: `${game.names[seat]} échange le 7 d'atout` });
    }
  },

  quitGame: () => {
    clearAiTimer();
    set({ game: null, pendingResult: null });
  },

  revealForPlayer: (seat) => {
    const { game } = get();
    if (!game) return;
    set({ game: { ...game, viewPlayer: seat, gatePending: false } });
    scheduleAiIfNeeded({ ...game, viewPlayer: seat, gatePending: false });
  },

  clearPendingResult: () => set({ pendingResult: null }),
  clearToast: () => set({ toast: null }),

  saveMatchResult: async (token, userId) => {
    const { game } = get();
    if (!game || !token || !userId) return;
    const players = game.names.map((name, i) => ({
      userId: i === 0 ? userId : null,
      guestName: i === 0 ? null : name,
      score: game.scores[i],
      won: game.scores[i] >= game.target,
    }));
    await gamesApi.save({
      mode: game.mode,
      variant: game.variant,
      playerCount: game.playerCount,
      targetScore: game.target,
      difficulty: game.diff,
      players,
    }, token);
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isAuto(game: GameState, seat: number): boolean {
  return (game.mode === 'ai' || game.mode === 'friend') && seat > 0;
}

function scheduleAiIfNeeded(game: GameState) {
  if (!game || game.handOver || game.gatePending) return;
  if (game.trick.length === game.playerCount) return; // pending resolution
  const { turn } = game;
  if (!isAuto(game, turn)) {
    if (game.mode === 'local' && turn !== game.viewPlayer) {
      useGameStore.setState(s => ({ game: s.game ? { ...s.game, gatePending: true } : null }));
    }
    return;
  }
  clearAiTimer();
  aiTimer = setTimeout(() => runAiTurn(turn), 780);
}

function runAiTurn(seat: number) {
  const { game } = useGameStore.getState();
  if (!game || game.handOver || game.turn !== seat) return;

  if (game.trick.length === 0) {
    // Annoces + optionnel échange du 7
    const combos = aiChooseCombos(game, seat);
    let current = game;
    for (const combo of combos) {
      if (combo.type === 'chouine') {
        const result = computeHandResult(current, seat);
        const next = applyHandResult(current, result);
        useGameStore.setState({ game: next, pendingResult: result, toast: `${current.names[seat]} réalise une CHOUINE !` });
        return;
      }
      current = applyDeclareCombo(current, seat, combo);
      const toastMsg = combo.setsTrump && combo.suit
        ? `${game.names[seat]} → ${combo.label} +${combo.value} · Atout : ${getSuitSymbol(combo.suit)}`
        : `${game.names[seat]} annonce ${combo.label}  +${combo.value}`;
      useGameStore.setState({ game: current, toast: toastMsg });
    }

    // Échange du 7
    if (current.turnUp && current.phase === 'draw' && current.trump &&
      current.players[seat].hand.some(c => c.s === current.trump && c.r === '7')) {
      const exchanged = applyExchangeSeven(current, seat);
      if (exchanged !== current) {
        current = exchanged;
        useGameStore.setState({ game: current, toast: `${game.names[seat]} échange le 7 d'atout` });
      }
    }

    aiTimer = setTimeout(() => {
      const { game: g } = useGameStore.getState();
      if (!g || g.handOver || g.turn !== seat) return;
      const card = aiChooseLead(g, seat);
      useGameStore.getState().playCard(seat, card);
    }, 480);
  } else {
    const card = aiChooseResponse(game, seat);
    useGameStore.getState().playCard(seat, card);
  }
}

function endCurrentHand(game: GameState) {
  const result = computeHandResult(game);
  const next = applyHandResult(game, result);
  useGameStore.setState({ game: next, pendingResult: result });
}

function checkAuSept(game: GameState) {
  let g = game;
  if (shouldAnnounceAuSept(g)) {
    g = { ...g, sevenAnnounced: true };
    useGameStore.setState({ game: g, toast: `${g.names[g.turn]} — au sept !` });
  } else {
    useGameStore.setState({ game: g });
  }
  scheduleAiIfNeeded(g);
}

function buildDealToast(game: GameState): string {
  const trumpLabel = game.trump
    ? `${SUIT_SYMBOL[game.trump]} atout`
    : 'sans atout';
  return `${trumpLabel}  —  ${game.names[game.leader]} entame`;
}

function getSuitSymbol(suit: string): string {
  return SUIT_SYMBOL[suit as keyof typeof SUIT_SYMBOL] ?? suit;
}
