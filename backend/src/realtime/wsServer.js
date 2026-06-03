'use strict';

// ─── Serveur WebSocket PvP ────────────────────────────────────────────────────
// Attache un serveur WebSocket (`ws`) au serveur HTTP existant, sur le chemin
// `/ws`. Authentifie chaque connexion via le JWT (passé en query `?token=`, car
// l'API WebSocket du navigateur ne permet pas d'en-tête Authorization), relaie
// les actions vers la session autoritaire du joueur, et diffuse l'état filtré.
//
// Protocole (JSON) :
//   client → serveur : { t: 'action', action: {...} } | { t: 'sync' }
//   serveur → client : { t: 'state', state } | { t: 'error', error } | { t: 'hello', userId }

const { WebSocketServer } = require('ws');
const { verifyToken } = require('../middleware/auth');
const registry = require('./sessionRegistry');

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

/**
 * @param {http.Server} httpServer
 * @param {object} [opts]
 * @param {(outcome:object)=>void} [opts.onMatchComplete]  appelé à la fin d'un match
 * @param {string} [opts.path]
 */
function attachWebSocketServer(httpServer, opts = {}) {
  const onMatchComplete = opts.onMatchComplete || ((outcome) => {
    // Branche par défaut : la persistance classée (Elo) sera raccordée ici une
    // fois le matchmaking en place (cf. #19). getMatchOutcome() fournit déjà
    // tout le nécessaire (variante, joueurs, scores, vainqueur).
    console.log(`[ws] match terminé (session ${outcome.sessionId}) — enregistrement classé à brancher`);
  });

  const wss = new WebSocketServer({ server: httpServer, path: opts.path || '/ws' });

  // userId -> Set<ws> (un joueur peut avoir plusieurs onglets ; on diffuse à tous)
  const sockets = new Map();

  function addSocket(userId, ws) {
    if (!sockets.has(userId)) sockets.set(userId, new Set());
    sockets.get(userId).add(ws);
  }
  function removeSocket(userId, ws) {
    const set = sockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) sockets.delete(userId);
  }

  function pushStateTo(userId, session) {
    const set = sockets.get(userId);
    if (!set) return;
    const snap = session.snapshotFor(userId);
    for (const ws of set) send(ws, { t: 'state', state: snap });
  }

  function broadcast(session) {
    for (const p of session.players) pushStateTo(p.userId, session);
  }

  wss.on('connection', (ws, req) => {
    let user;
    try {
      const url = new URL(req.url, 'http://localhost');
      user = verifyToken(url.searchParams.get('token'));
    } catch {
      user = null;
    }
    if (!user) {
      send(ws, { t: 'error', error: 'Authentification requise.' });
      ws.close(4001, 'unauthorized');
      return;
    }
    ws.userId = user.id;
    addSocket(user.id, ws);
    send(ws, { t: 'hello', userId: user.id });

    // Reprise : si une partie est en cours pour ce joueur, on lui renvoie l'état.
    const existing = registry.sessionForUser(user.id);
    if (existing) pushStateTo(user.id, existing);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { t: 'error', error: 'JSON invalide.' }); }

      const session = registry.sessionForUser(user.id);
      if (!session) return send(ws, { t: 'error', error: 'Aucune partie en cours.' });

      if (msg.t === 'sync') {
        return pushStateTo(user.id, session);
      }
      if (msg.t === 'action') {
        const res = session.applyAction(user.id, msg.action);
        if (!res.ok) send(ws, { t: 'error', error: res.error });
        // On rediffuse l'état (à jour ou inchangé) aux deux joueurs.
        broadcast(session);
        if (session.finished) {
          const outcome = { sessionId: session.id, ...session.getMatchOutcome() };
          try { onMatchComplete(outcome); }
          catch (e) { console.error('[ws] onMatchComplete a échoué :', e.message); }
          registry.endSession(session.id);
        }
        return;
      }
      send(ws, { t: 'error', error: 'Message inconnu.' });
    });

    ws.on('close', () => removeSocket(user.id, ws));
    ws.on('error', () => removeSocket(user.id, ws));
  });

  return { wss, sockets };
}

module.exports = { attachWebSocketServer };
