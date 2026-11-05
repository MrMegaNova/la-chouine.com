'use strict';

// ─── Suppression de compte côté temps réel (#238) ─────────────────────────────
// Pont entre la route Express et le serveur WebSocket, sur le même principe que
// notifier.js : le wsServer enregistre son traitement (forfait, file, défis,
// fermeture des sockets), la route l'appelle sans connaître le transport.
//
// Contrairement à une notification, ce n'est pas du best-effort : sans serveur
// temps réel, un joueur pourrait fuir une défaite. On échoue donc plutôt que de
// supprimer le compte sans forfait.

let handler = null;

/** @param {((userId: string, deleteAccount: () => Promise<unknown>) => Promise<void>)|null} fn */
function setHandler(fn) { handler = fn; }

async function removeAccount(userId, deleteAccount) {
  if (!handler) throw new Error('Serveur temps réel non initialisé.');
  await handler(userId, deleteAccount);
}

module.exports = { setHandler, removeAccount };
