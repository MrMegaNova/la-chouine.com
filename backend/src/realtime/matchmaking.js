'use strict';

// ─── Matchmaking PvP par Elo ──────────────────────────────────────────────────
// File d'attente par variante. Chaque ticket porte l'Elo du joueur. L'appariement
// se fait dans une **fenêtre d'Elo qui s'élargit avec le temps d'attente**, afin
// de garantir une partie même quand la file est creuse :
//   fenêtre(attente) = initialWindow + growthPerStep × ⌊attente / stepMs⌋
//   au-delà de fallbackMs, la fenêtre devient infinie (on accepte n'importe qui).
// Module **pur** (aucune dépendance DB/réseau) → entièrement testable.

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

  /** Demi-largeur de fenêtre d'Elo tolérée par un ticket selon son temps d'attente. */
  windowFor(ticket, now) {
    const elapsed = now - ticket.joinedAt;
    if (elapsed >= this.fallbackMs) return Infinity;
    const steps = Math.floor(elapsed / this.stepMs);
    return this.initialWindow + steps * this.growthPerStep;
  }

  /**
   * Apparie les joueurs compatibles et les retire des files.
   * @returns {Array<[ticket, ticket]>} paires formées
   */
  findMatches(now = Date.now()) {
    const pairs = [];
    for (const q of this.queues.values()) {
      const tickets = [...q.values()].sort((a, b) => a.rating - b.rating);
      const used = new Set();
      for (let i = 0; i < tickets.length; i++) {
        if (used.has(tickets[i].userId)) continue;
        // Plus proche voisin (par Elo) non encore apparié.
        let j = i + 1;
        while (j < tickets.length && used.has(tickets[j].userId)) j++;
        if (j >= tickets.length) continue;
        const gap = Math.abs(tickets[i].rating - tickets[j].rating);
        // Appariés si l'écart tient dans la fenêtre de l'un OU l'autre (le plus
        // patient élargit assez sa recherche pour accepter le voisin).
        const win = Math.max(this.windowFor(tickets[i], now), this.windowFor(tickets[j], now));
        if (gap <= win) {
          pairs.push([tickets[i], tickets[j]]);
          used.add(tickets[i].userId);
          used.add(tickets[j].userId);
        }
      }
      for (const id of used) q.delete(id);
    }
    return pairs;
  }
}

module.exports = { Matchmaker };
