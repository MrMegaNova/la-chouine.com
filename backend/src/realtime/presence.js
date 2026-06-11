'use strict';

// ─── Présence (compteurs) ─────────────────────────────────────────────────────
// Point de partage entre le serveur WebSocket (qui SAIT qui est connecté) et
// les routes Express (qui veulent l'afficher) sans coupler les deux : le
// wsServer enregistre un fournisseur, `GET /api/online` le consomme.
// Compteurs uniquement — jamais de liste de joueurs ni de noms (cf. #43).
// Limite assumée : par process ; à agréger via Redis pour scaler (cf. #31).

let provider = null;

/** @param {() => {online:number,inQueue:number,inGame:number}} fn */
function setProvider(fn) { provider = fn; }

function getPresence() {
  return provider ? provider() : { online: 0, inQueue: 0, inGame: 0 };
}

function reset() { provider = null; } // utilitaire de test

module.exports = { setProvider, getPresence, reset };
