'use strict';

// ─── Exécuteur partagé des fixtures de parité moteur (#128) ───────────────────
// Le moteur de jeu est dupliqué : `frontend/src/game/engine.ts` (TS, vitest) et
// `backend/src/game/engine.js` (JS, node:test). Une divergence de règle casse
// silencieusement le PvP.
//
// Ce module, en CommonJS pur (consommable par les deux runners), exécute une
// même fixture contre un moteur donné et renvoie un résultat **normalisé**
// (Set → tableau, sous-ensemble stable des états). Chaque suite asserte que ce
// résultat égale le `expect` versionné de la fixture : les deux moteurs doivent
// donc produire EXACTEMENT le même comportement, sinon l'un des deux est rouge.
//
// On ne couvre que des fonctions déterministes (pas la donne aléatoire, traitée
// par invariants) et on évite les champs légitimement divergents — ex.
// `applyResolveTrick` pose `lastTrickBySeat` côté TS mais au niveau session
// côté back (#95) : on ne compare donc pas l'état complet de cette fonction.

function card(c) {
  return { s: c.s, r: c.r };
}

/** Reconstruit un état moteur natif : `declared` redevient un Set. */
function hydrateState(state) {
  return {
    ...state,
    players: (state.players || []).map((p) => ({
      hand: (p.hand || []).map(card),
      won: (p.won || []).map(card),
      declared: new Set(p.declared || []),
      annonce: p.annonce || 0,
    })),
  };
}

/** Sous-ensemble stable et comparable d'une annonce. */
function normCombo(c) {
  return { type: c.type, suit: c.suit == null ? null : c.suit, sig: c.sig, value: c.value, setsTrump: c.setsTrump };
}

function runCase(engine, fx) {
  switch (fx.fn) {
    case 'cardBeats':
      return engine.cardBeats(card(fx.current), card(fx.challenger), fx.trump == null ? null : fx.trump);

    case 'resolveTrickWinner':
      return engine.resolveTrickWinner(
        fx.trick.map((t) => ({ p: t.p, card: card(t.card) })),
        fx.trump == null ? null : fx.trump,
      );

    case 'getLegalMoves':
      return engine.getLegalMoves(hydrateState(fx.state), fx.seat).map(card);

    case 'getAvailableCombos':
      return engine.getAvailableCombos(hydrateState(fx.state), fx.seat).map(normCombo);

    case 'computeHandResult':
      return engine.computeHandResult(hydrateState(fx.state), fx.forceWinner);

    case 'shouldAnnounceAuSept':
      return engine.shouldAnnounceAuSept(hydrateState(fx.state));

    case 'applyExchangeSeven': {
      const out = engine.applyExchangeSeven(hydrateState(fx.state), fx.seat);
      return {
        turnUp: out.turnUp ? card(out.turnUp) : null,
        hand: out.players[fx.seat].hand.map(card),
      };
    }

    case 'dealInvariants':
      return dealInvariants(engine, fx);

    default:
      throw new Error(`Fixture de parité : fonction inconnue « ${fx.fn} »`);
  }
}

// La donne est aléatoire (shuffle non reproductible entre TS et JS) : on ne
// compare pas une sortie exacte mais des INVARIANTS structurels que les deux
// moteurs doivent satisfaire à chaque distribution.
function dealInvariants(engine, fx) {
  const { variant, playerCount, iterations = 50 } = fx;
  const cardsEach = playerCount === 2 ? 5 : 3;
  const expectTalon = variant === 'mondoubleau'
    ? 32 - cardsEach * playerCount
    : 32 - cardsEach * playerCount - 1;

  let handsOk = true;
  let trumpOk = true;
  let talonOk = true;
  let conservationOk = true;

  for (let it = 0; it < iterations; it++) {
    const g = engine.dealHand(engine.createGame({
      mode: 'online',
      variant,
      playerCount,
      target: 3,
      names: Array.from({ length: playerCount }, (_, i) => `P${i}`),
    }));

    if (!g.players.every((p) => p.hand.length === cardsEach)) handsOk = false;

    if (variant === 'mondoubleau') {
      if (g.trump !== null || g.turnUp !== null) trumpOk = false;
    } else if (!g.trump || !g.turnUp || g.turnUp.s !== g.trump) {
      trumpOk = false;
    }

    if (g.talon.length !== expectTalon) talonOk = false;

    const all = [
      ...g.players.flatMap((p) => p.hand),
      ...g.talon,
      ...(g.turnUp ? [g.turnUp] : []),
    ];
    const keys = new Set(all.map((c) => `${c.s}|${c.r}`));
    if (all.length !== 32 || keys.size !== 32) conservationOk = false;
  }

  return { handsOk, trumpOk, talonOk, conservationOk };
}

module.exports = { runCase };
