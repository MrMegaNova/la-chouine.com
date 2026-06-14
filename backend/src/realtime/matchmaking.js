'use strict';

// ─── Matchmaking PvP par Elo ──────────────────────────────────────────────────
// File d'attente par variante. Chaque ticket porte l'Elo du joueur. L'appariement
// se fait dans une **fenêtre d'Elo qui s'élargit avec le temps d'attente**, afin
// de garantir une partie même quand la file est creuse :
//   fenêtre(attente) = initialWindow + growthPerStep × ⌊attente / stepMs⌋
//   au-delà de fallbackMs, la fenêtre devient infinie (on accepte n'importe qui).
// Module **pur** (aucune dépendance DB/réseau) → entièrement testable.

// ── Cœur d'appariement (pur, sans état) ───────────────────────────────────────
// Extrait pour être partagé par la file en mémoire (Matchmaker, mono-instance)
// et par la file Redis (matchmakingStore, multi-instance #31) : une seule
// source de vérité pour la fenêtre d'Elo et l'appariement plus-proche-voisin.

/** Demi-largeur de fenêtre d'Elo tolérée par un ticket selon son temps d'attente. */
function windowFor(ticket, now, params) {
  const elapsed = now - ticket.joinedAt;
  if (elapsed >= params.fallbackMs) return Infinity;
  const steps = Math.floor(elapsed / params.stepMs);
  return params.initialWindow + steps * params.growthPerStep;
}

/**
 * Apparie une liste de tickets (une seule variante) par plus proche voisin Elo,
 * dans la fenêtre élargie par l'attente. Pur : ne mute pas l'entrée.
 * @returns {Array<[ticket, ticket]>} paires formées
 */
function pairTickets(tickets, params, now) {
  const sorted = [...tickets].sort((a, b) => a.rating - b.rating);
  const used = new Set();
  const pairs = [];
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(sorted[i].userId)) continue;
    // Plus proche voisin (par Elo) non encore apparié.
    let j = i + 1;
    while (j < sorted.length && used.has(sorted[j].userId)) j++;
    if (j >= sorted.length) continue;
    const gap = Math.abs(sorted[i].rating - sorted[j].rating);
    // Appariés si l'écart tient dans la fenêtre de l'un OU l'autre (le plus
    // patient élargit assez sa recherche pour accepter le voisin).
    const win = Math.max(windowFor(sorted[i], now, params), windowFor(sorted[j], now, params));
    if (gap <= win) {
      pairs.push([sorted[i], sorted[j]]);
      used.add(sorted[i].userId);
      used.add(sorted[j].userId);
    }
  }
  return pairs;
}

class Matchmaker {
  constructor(opts = {}) {
    this.initialWindow = opts.initialWindow ?? 50;
    this.growthPerStep = opts.growthPerStep ?? 25;
    this.stepMs = opts.stepMs ?? 3000;
    this.fallbackMs = opts.fallbackMs ?? 30000;
    this.queues = new Map(); // variant -> Map<userId, ticket>
  }

  /** Inscrit (ou réinscrit) un joueur dans la file d'une variante. */
  join({ userId, name, rating, variant }, now = Date.now()) {
    this.leave(userId); // un seul ticket par joueur
    if (!this.queues.has(variant)) this.queues.set(variant, new Map());
    this.queues.get(variant).set(userId, { userId, name, rating, variant, joinedAt: now });
  }

  /** Retire un joueur de toute file. Renvoie true s'il y était. */
  leave(userId) {
    for (const q of this.queues.values()) {
      if (q.delete(userId)) return true;
    }
    return false;
  }

  has(userId) {
    for (const q of this.queues.values()) if (q.has(userId)) return true;
    return false;
  }

  size(variant) {
    return this.queues.has(variant) ? this.queues.get(variant).size : 0;
  }

  /** Joueurs en attente, toutes variantes confondues. */
  totalSize() {
    let n = 0;
    for (const q of this.queues.values()) n += q.size;
    return n;
  }

  /** Paramètres de fenêtre de cette instance (pour les helpers purs). */
  get params() {
    return {
      initialWindow: this.initialWindow,
      growthPerStep: this.growthPerStep,
      stepMs: this.stepMs,
      fallbackMs: this.fallbackMs,
    };
  }

  /** Demi-largeur de fenêtre d'Elo tolérée par un ticket selon son temps d'attente. */
  windowFor(ticket, now) {
    return windowFor(ticket, now, this.params);
  }

  /**
   * Apparie les joueurs compatibles et les retire des files.
   * @returns {Array<[ticket, ticket]>} paires formées
   */
  findMatches(now = Date.now()) {
    const pairs = [];
    for (const q of this.queues.values()) {
      const qPairs = pairTickets([...q.values()], this.params, now);
      for (const [a, b] of qPairs) {
        pairs.push([a, b]);
        q.delete(a.userId);
        q.delete(b.userId);
      }
    }
    return pairs;
  }
}

module.exports = { Matchmaker, windowFor, pairTickets };
