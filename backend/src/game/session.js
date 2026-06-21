'use strict';

// ─── Session de partie PvP — état autoritatif côté serveur ────────────────────
// Encapsule le moteur (engine.js) pour arbitrer une partie en ligne 1 contre 1.
// Le serveur est seul juge : tout coup est validé (tour, légalité) avant d'être
// appliqué, et chaque joueur ne reçoit qu'une vue filtrée (sa main, le décompte
// des mains adverses). Aucune logique de jeu ne vit côté client pour le PvP.

const {
  createGame, dealHand, drawCut, finishCut, smallestDrawSeat,
  applyPlayCard, applyResolveTrick, applyDeclareCombo,
  applyExchangeSeven, computeHandResult, applyHandResult, getAvailableCombos,
  isLegalMove, resolveTrickWinner, shouldAnnounceAuSept, getLegalMoves,
  comboCards, sameCard,
} = require('./engine');
const { PTS, ORDER } = require('./constants');
const turnClock = require('./turnClock');

// ── Sérialisation de l'état moteur pour Redis (#31) ───────────────────────────
// L'état du moteur est presque entièrement JSON-isable, à une exception près :
// chaque joueur porte `declared`, un Set des annonces déjà posées (engine.js).
// JSON.stringify le réduirait silencieusement à `{}` (perte des annonces → un
// joueur pourrait ré-annoncer illégalement après un aller-retour Redis). On
// l'aplatit en tableau au stockage et on le restaure en Set au chargement.
function serializeState(state) {
  return {
    ...state,
    players: state.players.map(p => ({ ...p, declared: [...p.declared] })),
  };
}
function deserializeState(state) {
  return {
    ...state,
    players: state.players.map(p => ({ ...p, declared: new Set(p.declared) })),
  };
}

class GameSession {
  /**
   * @param {object}  o
   * @param {string}  o.id        Identifiant de session
   * @param {Array}   o.players   [{ userId, name }] — index = siège (2 joueurs)
   * @param {string}  [o.variant] 'classic' | 'mondoubleau'
   * @param {number}  [o.target]  3 | 5
   * @param {boolean} [o.rated]   false = partie amicale, sans incidence Elo (#47)
   */
  constructor({ id, players, variant = 'classic', target = 3, rated = true, clockOptions }) {
    if (!Array.isArray(players) || players.length !== 2) {
      throw new Error('GameSession : exactement 2 joueurs requis (v1).');
    }
    this.id = id;
    this.players = players;
    this.variant = variant;
    this.target = target;
    this.rated = rated !== false;

    this.finished = false;
    this.matchResult = null;        // { winnerSeat, scores } à la fin du match
    this.lastTrick = null;          // { cards:[{p,card}], winner } pour l'animation
    this.lastTrickBySeat = [null, null]; // dernier pli ramassé par chaque siège (#95)
    this.lastExchange = null;       // { seat, handNo } — dernier échange du 7 d'atout (#76)
    this.lastHandResult = null;     // HandResult de la dernière main terminée
    this.nextHandAcks = new Set();  // sièges ayant validé « main suivante »
    // Échéance de la coupe (#201) : pendant la phase `cut`, un siège qui ne
    // pioche pas dans le délai imparti perd par forfait. Posée/rafraîchie par le
    // driver temps réel (wsServer) ; balayée par le sweep. null hors phase cut.
    this.cutDeadline = null;
    // Échéance de révélation de la coupe (#201) : une fois les deux sièges
    // tirés, on entre en phase `cutReveal` ; les cartes restent affichées (avec
    // l'indication « qui commence ») jusqu'à cette échéance, puis la 1ʳᵉ main est
    // distribuée. Posée par le driver temps réel (wsServer) ; balayée par le
    // sweep. null hors phase cutReveal.
    this.revealDeadline = null;
    // Horloge de coup (#141) — parties classées uniquement ; pilotée par le
    // driver temps réel (wsServer), qui arme l'échéance et gère la pause.
    this.clock = this.rated ? turnClock.createClock(clockOptions) : null;

    // La partie démarre en phase de coupe (#201) : la 1ʳᵉ main n'est PAS encore
    // distribuée, chaque joueur doit d'abord piocher pour désigner le donneur.
    this.state = createGame({
      mode: 'online',
      variant,
      playerCount: 2,
      target,
      names: players.map(p => p.name),
    });
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
      case 'cut':          return this._cut(seat, action.index);
      case 'play':         return this._play(seat, action.card);
      case 'declare':      return this._declare(seat, action.sig, action.card);
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

  // Coupe interactive (#201) : le joueur signale qu'il pioche ; le moteur
  // détermine la carte (déterminisme serveur, invariant #116). Quand les deux
  // sièges ont pioché, on entre en phase de révélation (`cut` → `cutReveal`) :
  // les cartes restent affichées le temps d'annoncer qui commence ; la donne est
  // ensuite déclenchée par `finishReveal` (échéance armée par le driver wsServer).
  _cut(seat, index) {
    const s = this.state;
    if (s.phase !== 'cut') return { ok: false, error: 'La coupe est terminée.' };
    if (s.cut.picks[seat] !== null) return { ok: false, error: 'Vous avez déjà coupé.' };
    // `index` = carte choisie parmi les 32 face cachée (#216). Validé par le
    // moteur (bornes) ; le client ne connaît jamais le paquet, seulement un index.
    const next = drawCut(s, seat, index);
    if (next === s) return { ok: false, error: 'Pioche impossible.' };
    this.state = next;
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
      this.lastTrickBySeat[winner] = this.lastTrick; // consultation adverse (#95)
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

  // Règle (#77) : une annonce se fait « en même temps qu'on joue sa carte »,
  // et la carte jouée doit composer l'annonce. Action atomique annonce + carte
  // (sauf chouine, qui clôt le coup sans jouer). L'annonce est permise aussi
  // en réponse (#90) — « lorsque son adversaire a abattu sa carte, il doit
  // montrer son annonce » — tant que la carte jouée reste légale.
  _declare(seat, sig, card) {
    const s = this.state;
    if (s.handOver) return { ok: false, error: 'La main est terminée.' };
    if (s.turn !== seat || s.trick.length >= s.playerCount) {
      return { ok: false, error: 'Annonce impossible maintenant.' };
    }
    const combo = getAvailableCombos(s, seat).find(c => c.sig === sig);
    if (!combo) return { ok: false, error: 'Annonce indisponible.' };

    if (combo.type === 'chouine') {
      // La chouine clôt le coup sans jouer de carte : on ne peut pas la
      // déclarer au milieu d'un pli entamé.
      if (s.trick.length !== 0) return { ok: false, error: 'Annonce impossible maintenant.' };
      // Les cartes de la chouine sont étalées, puis le coup est gagné.
      const cards = comboCards(s.players[seat].hand, combo);
      const revealed = { ...s, lastAnnounce: { seat, sig, label: combo.label, cards } };
      const result = computeHandResult(revealed, seat);
      this.state = this._endHand(applyHandResult(revealed, result), result);
      this.lastHandResult = result;
      return { ok: true };
    }

    if (!card) return { ok: false, error: 'Annoncer impose de jouer une carte de l’annonce.' };
    const cc = comboCards(s.players[seat].hand, combo);
    if (!cc.some(c => sameCard(c, card))) {
      return { ok: false, error: 'La carte jouée doit composer l’annonce.' };
    }

    this.state = applyDeclareCombo(s, seat, combo); // pose aussi lastAnnounce (étalée)
    const res = this._play(seat, card);
    // Rollback si la carte est illégale (ex. en réponse de phase finale, la
    // carte de l'annonce doit fournir/monter/couper) : rien n'est crédité.
    if (!res.ok) { this.state = s; return res; }
    return { ok: true };
  }

  // L'échange du 7 d'atout est permis à son tour de jeu, y compris en
  // réponse à un pli (#76) — la règle n'exige pas d'avoir la main, seulement
  // que la retourne soit encore là (garanti par applyExchangeSeven).
  _exchangeSeven(seat) {
    const s = this.state;
    if (s.handOver) return { ok: false, error: 'La main est terminée.' };
    if (s.turn !== seat || s.trick.length >= s.playerCount) {
      return { ok: false, error: 'Échange impossible maintenant.' };
    }
    const next = applyExchangeSeven(s, seat);
    if (next === s) return { ok: false, error: 'Échange du 7 impossible.' };
    this.state = next;
    // Signale l'échange aux deux joueurs (#76) — sans quoi l'adversaire ne voit
    // que la retourne changer silencieusement. Dédupliqué par main + siège.
    this.lastExchange = { seat, handNo: this.state.handNo };
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
      this.lastTrickBySeat = [null, null];
      this.lastExchange = null;
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

  // ── Horloge de coup (#141) ──────────────────────────────────────────────────
  // Le module turnClock est pur ; ces méthodes l'appliquent à l'état de session.
  // Le driver (wsServer) arme l'échéance réelle et appelle clockTimeout() à
  // l'expiration. Toutes prennent `now` pour rester déterministes et testables.

  /** Échéance atteinte : joue un coup automatique (carte légale la moins chère)
   *  et compte une pénalité ; au quota, clôt par forfait. */
  clockTimeout(_now = Date.now()) {
    if (!this.clock || this.finished || this.state.handOver) return { ok: false };
    const seat = this.clock.seat;
    if (seat === null) return { ok: false };

    if (turnClock.recordTimeout(this.clock, seat)) {
      this.forfeit(seat, 'timeout'); // trop de coups automatiques → défaite
      return { ok: true, seat, forfeit: true };
    }
    const card = this._autoCard(seat);
    if (!card) return { ok: false };
    const res = this._play(seat, card);
    return { ok: res.ok, seat, forfeit: false, card };
  }

  /** Échéance de la coupe atteinte (#201) : le siège qui n'a pas encore pioché
   *  perd par forfait (l'adversaire gagne). À 2 joueurs, un seul peut être en
   *  retard. Renvoie { ok, seat? }. */
  cutTimeout() {
    if (this.finished || this.state.phase !== 'cut') return { ok: false };
    const seat = this.state.cut.picks.findIndex(p => p === null);
    if (seat < 0) return { ok: false };
    const res = this.forfeit(seat, 'timeout');
    return res.ok ? { ok: true, seat } : { ok: false };
  }

  /** Échéance de révélation atteinte (#201) : on clôt la phase `cutReveal` et on
   *  distribue la 1ʳᵉ main (donneur = plus petite carte). Renvoie { ok }. */
  finishReveal() {
    if (this.finished || this.state.phase !== 'cutReveal') return { ok: false };
    const next = finishCut(this.state);
    if (next === this.state) return { ok: false };
    this.state = next;
    this.revealDeadline = null;
    return { ok: true };
  }

  /** Carte « la moins coûteuse » parmi les coups légaux (heuristique du coup auto). */
  _autoCard(seat) {
    const legal = getLegalMoves(this.state, seat);
    if (!legal.length) return null;
    return [...legal].sort((a, b) => PTS[a.r] - PTS[b.r] || ORDER[a.r] - ORDER[b.r])[0];
  }

  /** Vue d'horloge pour le snapshot (mêmes infos pour les deux joueurs). */
  clockView(now = Date.now()) {
    if (!this.clock) return null;
    return {
      seat: this.clock.seat,
      remainingMs: turnClock.remainingMs(this.clock, now),
      paused: this.clock.paused,
      baseMs: this.clock.baseMs,
      reserveMs: [...this.clock.reserve],
      timeouts: [...this.clock.timeouts],
    };
  }

  /** Résultat du match pour l'enregistrement classé (Elo), ou null si non terminé. */
  getMatchOutcome() {
    if (!this.finished || !this.matchResult) return null;
    const { winnerSeat, scores } = this.matchResult;
    return {
      variant: this.variant,
      target: this.target,
      rated: this.rated,
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
      rated: this.rated,
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
      // Coupe (#201) : cartes déjà révélées par siège. Le paquet caché n'est
      // JAMAIS transmis (sinon le client connaîtrait les futures cartes). En
      // phase `cut`, on expose l'échéance de forfait ; en `cutReveal`, toutes les
      // cartes sont visibles et on expose l'échéance de révélation + le donneur
      // (pour afficher « qui commence »).
      cut: s.phase === 'cut'
        ? { picks: s.cut.picks, deadline: this.cutDeadline, deckCount: s.cut.deck.length }
        : s.phase === 'cutReveal'
          ? { picks: s.cut.picks, reveal: true, deadline: this.revealDeadline, dealer: smallestDrawSeat(s.cut.picks) }
          : null,
      lastTrick: this.lastTrick,
      // Dernier pli ramassé par l'adversaire (#95) : seul pli adverse que la
      // règle autorise à consulter — même si on a ramassé des plis depuis.
      opponentLastTrick: seat >= 0 ? this.lastTrickBySeat[1 - seat] : null,
      // Horloge de coup (#141) — null hors partie classée.
      clock: this.clockView(),
      // Dernier échange du 7 d'atout (#76) — pour le signaler aux deux joueurs.
      lastExchange: this.lastExchange,
      lastAnnounce: s.lastAnnounce ?? null,
      lastHandResult: s.handOver ? this.lastHandResult : null,
      finished: this.finished,
      matchResult: this.matchResult,
      players: s.players.map((p, i) => ({
        seat: i,
        // Id public du joueur du siège (#85) : permet d'ouvrir son profil
        // depuis la table. Les sièges sont toujours occupés par des comptes en
        // PvP ; null par sécurité si jamais absent.
        id: (this.players[i] && this.players[i].userId) || null,
        handCount: p.hand.length,
        annonce: p.annonce,
        wonCount: p.won.length,
        // Main visible uniquement pour le joueur destinataire de ce snapshot.
        hand: i === seat ? p.hand : undefined,
        // Ses propres plis sont consultables à tout moment (#74) ; ceux de
        // l'adversaire restent un simple décompte (seul lastTrick est public).
        won: i === seat ? p.won : undefined,
        // Coups légaux fournis seulement au joueur dont c'est le tour.
        legalMoves: i === seat && s.turn === seat && !s.handOver
          ? getLegalMoves(s, seat)
          : undefined,
      })),
    };
  }

  // ── Sérialisation de session pour Redis (#31) ───────────────────────────────
  // État partagé entre instances : toJSON aplatit les Set (nextHandAcks +
  // players[].declared via serializeState) ; fromJSON reconstruit la session
  // SANS redistribuer de main (le constructeur, lui, distribue) en restaurant
  // les Set. Le moteur et l'horloge (objets plats) traversent tels quels.
  toJSON() {
    return {
      id: this.id,
      players: this.players,
      variant: this.variant,
      target: this.target,
      rated: this.rated,
      finished: this.finished,
      matchResult: this.matchResult,
      lastTrick: this.lastTrick,
      lastTrickBySeat: this.lastTrickBySeat,
      lastExchange: this.lastExchange,
      lastHandResult: this.lastHandResult,
      nextHandAcks: [...this.nextHandAcks],
      clock: this.clock,
      cutDeadline: this.cutDeadline,
      revealDeadline: this.revealDeadline,
      state: serializeState(this.state),
    };
  }

  static fromJSON(data) {
    const s = Object.create(GameSession.prototype);
    s.id = data.id;
    s.players = data.players;
    s.variant = data.variant;
    s.target = data.target;
    s.rated = data.rated;
    s.finished = data.finished;
    s.matchResult = data.matchResult;
    s.lastTrick = data.lastTrick;
    s.lastTrickBySeat = data.lastTrickBySeat;
    s.lastExchange = data.lastExchange;
    s.lastHandResult = data.lastHandResult;
    s.nextHandAcks = new Set(data.nextHandAcks);
    s.clock = data.clock;
    s.cutDeadline = data.cutDeadline ?? null;
    s.revealDeadline = data.revealDeadline ?? null;
    s.state = deserializeState(data.state);
    return s;
  }
}

module.exports = { GameSession };
