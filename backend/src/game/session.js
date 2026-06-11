'use strict';

// ─── Session de partie PvP — état autoritatif côté serveur ────────────────────
// Encapsule le moteur (engine.js) pour arbitrer une partie en ligne 1 contre 1.
// Le serveur est seul juge : tout coup est validé (tour, légalité) avant d'être
// appliqué, et chaque joueur ne reçoit qu'une vue filtrée (sa main, le décompte
// des mains adverses). Aucune logique de jeu ne vit côté client pour le PvP.

const {
  createGame, dealHand, applyPlayCard, applyResolveTrick, applyDeclareCombo,
  applyExchangeSeven, computeHandResult, applyHandResult, getAvailableCombos,
  isLegalMove, resolveTrickWinner, shouldAnnounceAuSept, getLegalMoves,
} = require('./engine');

class GameSession {
  /**
   * @param {object}  o
   * @param {string}  o.id        Identifiant de session
   * @param {Array}   o.players   [{ userId, name }] — index = siège (2 joueurs)
   * @param {string}  [o.variant] 'classic' | 'mondoubleau'
   * @param {number}  [o.target]  3 | 5
   */
  constructor({ id, players, variant = 'classic', target = 3 }) {
    if (!Array.isArray(players) || players.length !== 2) {
      throw new Error('GameSession : exactement 2 joueurs requis (v1).');
    }
    this.id = id;
    this.players = players;
    this.variant = variant;
    this.target = target;

    this.finished = false;
    this.matchResult = null;        // { winnerSeat, scores } à la fin du match
    this.lastTrick = null;          // { cards:[{p,card}], winner } pour l'animation
    this.lastHandResult = null;     // HandResult de la dernière main terminée
    this.nextHandAcks = new Set();  // sièges ayant validé « main suivante »

    this.state = dealHand(createGame({
      mode: 'online',
      variant,
      playerCount: 2,
      target,
      names: players.map(p => p.name),
    }));
  }

  seatOf(userId) {
    return this.players.findIndex(p => p.userId === userId);
  }

  /**
   * Applique une action d'un joueur. Renvoie { ok, error? }.
   * @param {string} userId
   * @param {object} action  { type: 'play'|'declare'|'exchangeSeven'|'nextHand', ... }
   */
  applyAction(userId, action) {
    if (this.finished) return { ok: false, error: 'Partie terminée.' };
    const seat = this.seatOf(userId);
    if (seat < 0) return { ok: false, error: 'Joueur non inscrit dans cette partie.' };
    if (!action || typeof action.type !== 'string') return { ok: false, error: 'Action invalide.' };

    switch (action.type) {
      case 'play':         return this._play(seat, action.card);
      case 'declare':      return this._declare(seat, action.sig);
      case 'exchangeSeven':return this._exchangeSeven(seat);
      case 'nextHand':     return this._nextHand(seat);
      case 'forfeit':      return this.forfeit(seat, 'abandon');
      default:             return { ok: false, error: 'Type d’action inconnu.' };
    }
  }

  /**
   * Clôt le match par forfait du siège donné : l'adversaire gagne, le résultat
   * est enregistré comme une défaite Elo pleine (sinon abandonner permettrait
   * de fuir les défaites). `reason` : 'abandon' (volontaire) | 'timeout'
   * (déconnexion non revenue avant la fin du délai de grâce).
   */
  forfeit(seat, reason = 'abandon') {
    if (this.finished) return { ok: false, error: 'Partie terminée.' };
    if (seat !== 0 && seat !== 1) return { ok: false, error: 'Siège invalide.' };
    this.finished = true;
    this.matchResult = {
      winnerSeat: 1 - seat,
      scores: [...this.state.scores],
      forfeit: { by: seat, reason },
    };
    return { ok: true };
  }

  _play(seat, card) {
    const s = this.state;
    if (s.handOver) return { ok: false, error: 'La main est terminée.' };
    if (s.trick.length >= s.playerCount) return { ok: false, error: 'Pli en cours de résolution.' };
    if (s.turn !== seat) return { ok: false, error: 'Ce n’est pas votre tour.' };
    if (!card || !isLegalMove(s, seat, card)) return { ok: false, error: 'Coup illégal.' };

    this.lastTrick = null;
    let next = applyPlayCard(s, seat, card);

    if (next.trick.length === next.playerCount) {
      // Pli complet → résolution autoritaire immédiate (l'animation est gérée
      // côté client à partir de `lastTrick`).
      const winner = resolveTrickWinner(next.trick, next.trump);
      this.lastTrick = { cards: next.trick.map(t => ({ p: t.p, card: t.card })), winner };
      next = applyResolveTrick(next);

      if (next.players.some(p => p.hand.length === 0)) {
        next = this._endHand(next);
      } else if (shouldAnnounceAuSept(next)) {
        next = { ...next, sevenAnnounced: true };
      }
    }

    this.state = next;
    return { ok: true };
  }

  _declare(seat, sig) {
    const s = this.state;
    if (s.handOver) return { ok: false, error: 'La main est terminée.' };
    if (s.turn !== seat || s.trick.length !== 0) {
      return { ok: false, error: 'Annonce impossible maintenant.' };
    }
    const combo = getAvailableCombos(s, seat).find(c => c.sig === sig);
    if (!combo) return { ok: false, error: 'Annonce indisponible.' };

    if (combo.type === 'chouine') {
      const result = computeHandResult(s, seat); // chouine → gagne la main
      this.state = this._endHand(applyHandResult(s, result), result);
      this.lastHandResult = result;
      return { ok: true };
    }

    this.state = applyDeclareCombo(s, seat, combo);
    return { ok: true };
  }

  _exchangeSeven(seat) {
    const s = this.state;
    if (s.turn !== seat || s.trick.length !== 0) {
      return { ok: false, error: 'Échange impossible maintenant.' };
    }
    const next = applyExchangeSeven(s, seat);
    if (next === s) return { ok: false, error: 'Échange du 7 impossible.' };
    this.state = next;
    return { ok: true };
  }

  _nextHand(seat) {
    if (!this.state.handOver || this.finished) {
      return { ok: false, error: 'Aucune main à enchaîner.' };
    }
    this.nextHandAcks.add(seat);
    if (this.nextHandAcks.size >= this.state.playerCount) {
      this.nextHandAcks.clear();
      this.lastTrick = null;
      this.lastHandResult = null;
      this.state = dealHand(this.state);
    }
    return { ok: true };
  }

  // Termine la main : calcule le résultat, met à jour le score, et soit clôt le
  // match (objectif atteint), soit laisse l'état en `handOver` (attente d'un ack
  // des deux joueurs pour distribuer la main suivante).
  _endHand(stateAfterTrick, precomputed) {
    const result = precomputed || computeHandResult(stateAfterTrick);
    const next = precomputed ? stateAfterTrick : applyHandResult(stateAfterTrick, result);
    this.lastHandResult = result;
    this.nextHandAcks = new Set();

    if (result.matchWinner != null) {
      this.finished = true;
      this.matchResult = { winnerSeat: result.matchWinner, scores: [...next.scores] };
    }
    return next;
  }

  /** Résultat du match pour l'enregistrement classé (Elo), ou null si non terminé. */
  getMatchOutcome() {
    if (!this.finished || !this.matchResult) return null;
    const { winnerSeat, scores } = this.matchResult;
    return {
      variant: this.variant,
      target: this.target,
      players: this.players.map((p, seat) => ({
        userId: p.userId,
        name: p.name,
        seat,
        score: scores[seat],
        won: seat === winnerSeat,
      })),
    };
  }

  /**
   * Vue filtrée de l'état pour un joueur : sa main est visible, celles des
   * adversaires sont réduites à un décompte. Les Set sont sérialisés en tableaux.
   */
  snapshotFor(userId) {
    const seat = this.seatOf(userId);
    const s = this.state;
    return {
      sessionId: this.id,
      you: seat,
      variant: this.variant,
      target: this.target,
      names: s.names,
      scores: s.scores,
      trump: s.trump,
      turnUp: s.turnUp,
      talonCount: s.talon.length + (s.turnUp ? 1 : 0),
      trick: s.trick,
      leader: s.leader,
      turn: s.turn,
      phase: s.phase,
      handOver: s.handOver,
      handNo: s.handNo,
      lastTrick: this.lastTrick,
      lastHandResult: s.handOver ? this.lastHandResult : null,
      finished: this.finished,
      matchResult: this.matchResult,
      players: s.players.map((p, i) => ({
        seat: i,
        handCount: p.hand.length,
        annonce: p.annonce,
        wonCount: p.won.length,
        // Main visible uniquement pour le joueur destinataire de ce snapshot.
        hand: i === seat ? p.hand : undefined,
        // Coups légaux fournis seulement au joueur dont c'est le tour.
        legalMoves: i === seat && s.turn === seat && !s.handOver
          ? getLegalMoves(s, seat)
          : undefined,
      })),
    };
  }
}

module.exports = { GameSession };
