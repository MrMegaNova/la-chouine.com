'use strict';

// ─── Notifications temps réel ─────────────────────────────────────────────────
// Pont entre les routes Express et le serveur WebSocket (#44), sur le même
// principe que presence.js : le wsServer enregistre sa fonction d'envoi, les
// routes notifient sans connaître le transport. Best-effort : destinataire
// hors ligne = notification perdue, c'est le badge (GET /api/friends/requests)
// qui sert de filet persistant.
//
// Format : { t:'notification', kind:'friendRequest'|…, ...données } — `kind`
// est extensible (défi entre amis #45, etc.).

let sender = null;

/** @param {(userId: string, obj: object) => void} fn */
function setSender(fn) { sender = fn; }

function notifyUser(userId, payload) {
  if (!sender) return;
  try { sender(userId, { t: 'notification', ...payload }); }
  catch (e) { console.error('[notifier] envoi échoué :', e.message); }
}

function reset() { sender = null; } // utilitaire de test

module.exports = { setSender, notifyUser, reset };
