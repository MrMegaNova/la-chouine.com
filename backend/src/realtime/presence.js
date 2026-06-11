'use strict';

// ─── Présence (compteurs) ─────────────────────────────────────────────────────
// Point de partage entre le serveur WebSocket (qui SAIT qui est connecté) et
// les routes Express (qui veulent l'afficher) sans coupler les deux : le
// wsServer enregistre un fournisseur, `GET /api/online` le consomme.
// Compteurs uniquement — jamais de liste de joueurs ni de noms (cf. #43).
// Limite assumée : par process ; à agréger via Redis pour scaler (cf. #31).

let provider = null;
let userProvider = null;

/** @param {() => {online:number,inQueue:number,inGame:number}} fn */
function setProvider(fn) { provider = fn; }

function getPresence() {
  return provider ? provider() : { online: 0, inQueue: 0, inGame: 0 };
}

/**
 * Présence d'un utilisateur précis (#46). Réservé aux contextes où le lien
 * est légitime (liste d'amis acceptés) — ne jamais l'exposer publiquement.
 * @param {(userId: string) => {online:boolean,inGame:boolean}} fn
 */
function setUserProvider(fn) { userProvider = fn; }

function userPresence(userId) {
  return userProvider ? userProvider(userId) : { online: false, inGame: false };
}

function reset() { provider = null; userProvider = null; } // utilitaire de test

module.exports = { setProvider, getPresence, setUserProvider, userPresence, reset };
