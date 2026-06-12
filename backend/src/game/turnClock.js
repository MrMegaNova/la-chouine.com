'use strict';

// ─── Horloge de coup (#141) — partie classée uniquement ───────────────────────
// Module PUR : opère sur un état sérialisable, toutes les fonctions reçoivent
// `now` (ms epoch) en argument → entièrement testable sans timers réels.
//
// Modèle (par joueur) :
//   - BASE_MS : temps « gratuit » par coup, remis à chaque tour.
//   - reserve : banque commune à la partie ; le temps d'un coup au-delà de BASE
//     y est déduit. Réserve vide → chaque coup est plafonné à BASE (anti-stall).
//   - pauseBudget : temps de pause cumulé autorisé par joueur ; une déconnexion
//     met l'horloge en pause et déduit du budget du déconnecté ; budget épuisé →
//     sa déconnexion ne met plus en pause (anti-abus déco/reco).
//   - timeouts : nombre de coups automatiques subis ; au-delà de MAX → forfait.

const DEFAULTS = {
  baseMs: 20_000,
  reserveMs: 120_000,
  pauseBudgetMs: 90_000,
  maxTimeouts: 3,
};

function createClock(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  return {
    baseMs: cfg.baseMs,
    maxTimeouts: cfg.maxTimeouts,
    reserve: [cfg.reserveMs, cfg.reserveMs],
    pauseBudget: [cfg.pauseBudgetMs, cfg.pauseBudgetMs],
    timeouts: [0, 0],
    seat: null,        // siège dont l'horloge tourne
    startedAt: null,   // début du tour courant (ms)
    deadline: null,    // échéance (ms) — repoussée à chaque reprise de pause
    pausedAccum: 0,    // temps de pause cumulé sur CE tour (déduit du temps utilisé)
    paused: false,
    pausedAt: null,
  };
}

// Démarre (ou redémarre) le décompte pour le siège actif. Idempotent : ne fait
// rien si le tour du même siège est déjà en cours.
function startTurn(clock, seat, now) {
  if (clock.seat === seat && clock.deadline !== null && !clock.paused) return clock;
  clock.seat = seat;
  clock.startedAt = now;
  clock.pausedAccum = 0;
  clock.paused = false;
  clock.pausedAt = null;
  clock.deadline = now + clock.baseMs + clock.reserve[seat];
  return clock;
}

// Temps restant pour le coup courant (gelé si en pause).
function remainingMs(clock, now) {
  if (clock.deadline === null) return null;
  const ref = clock.paused ? clock.pausedAt : now;
  return Math.max(0, clock.deadline - ref);
}

// Coup joué : déduit de la réserve le temps actif passé au-delà de BASE.
function commitMove(clock, now) {
  if (clock.seat === null || clock.startedAt === null) return clock;
  const active = Math.max(0, now - clock.startedAt - clock.pausedAccum);
  const over = Math.max(0, active - clock.baseMs);
  clock.reserve[clock.seat] = Math.max(0, clock.reserve[clock.seat] - over);
  clock.deadline = null;
  clock.seat = null;
  clock.startedAt = null;
  clock.pausedAccum = 0;
  clock.paused = false;
  clock.pausedAt = null;
  return clock;
}

// Met l'horloge en pause (déconnexion). `bySeat` = siège dont la déconnexion
// cause la pause ; sa déconnexion n'a d'effet que s'il lui reste du budget.
function pause(clock, bySeat, now) {
  if (clock.paused || clock.deadline === null) return false;
  if (clock.pauseBudget[bySeat] <= 0) return false; // budget épuisé → pas de pause
  clock.paused = true;
  clock.pausedAt = now;
  clock.pauseSeat = bySeat;
  return true;
}

// Reprend l'horloge : repousse l'échéance du temps de pause écoulé et déduit ce
// temps du budget du joueur ayant causé la pause. Si le budget est dépassé, la
// reprise est « anticipée » (l'échéance n'est repoussée que du budget restant).
function resume(clock, now) {
  if (!clock.paused) return clock;
  const seat = clock.pauseSeat;
  const elapsed = now - clock.pausedAt;
  const credited = Math.min(elapsed, clock.pauseBudget[seat]);
  clock.pauseBudget[seat] = Math.max(0, clock.pauseBudget[seat] - credited);
  clock.deadline += credited;
  clock.pausedAccum += credited;
  clock.paused = false;
  clock.pausedAt = null;
  clock.pauseSeat = null;
  return clock;
}

// Échéance atteinte ? (faux si en pause)
function isExpired(clock, now) {
  return clock.deadline !== null && !clock.paused && now >= clock.deadline;
}

// Enregistre un coup automatique ; renvoie true si le quota est atteint (forfait).
function recordTimeout(clock, seat) {
  clock.timeouts[seat] += 1;
  return clock.timeouts[seat] >= clock.maxTimeouts;
}

module.exports = {
  DEFAULTS, createClock, startTurn, remainingMs, commitMove,
  pause, resume, isExpired, recordTimeout,
};
