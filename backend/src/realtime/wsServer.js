'use strict';

// ─── Serveur WebSocket PvP ────────────────────────────────────────────────────
// Attache un serveur WebSocket (`ws`) au serveur HTTP existant, sur le chemin
// `/ws`. Authentifie chaque connexion via le JWT (passé en query `?token=`, car
// l'API WebSocket du navigateur ne permet pas d'en-tête Authorization).
//
// Deux rôles :
//   1. Matchmaking : le joueur rejoint une file par variante ; à l'appariement
//      (Elo proche, fenêtre élargie) une GameSession est créée et notifiée.
//   2. Jeu : relaie les actions vers la session autoritaire et diffuse l'état
//      filtré aux deux joueurs ; à la fin du match, persiste le résultat (Elo).
//
// Protocole (JSON) :
//   client → serveur : { t:'queue', action:'join'|'leave', variant } |
//                       { t:'action', action:{...} } | { t:'sync' }
//   serveur → client : { t:'hello', userId } | { t:'queue', status, ... } |
//                       { t:'matchFound', sessionId, opponent } |
//                       { t:'state', state } | { t:'error', error }

const { WebSocketServer } = require('ws');
const { verifyToken } = require('../middleware/auth');
const registry = require('./sessionRegistry');
const { Matchmaker } = require('./matchmaking');

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

// Persistance classée par défaut (production) : enregistre le match et met à
// jour l'Elo. Injectable dans les tests pour éviter la DB.
function defaultOnMatchComplete(outcome) {
  const { recordMatch } = require('../services/matchRecorder');
  Promise.resolve()
    .then(() => recordMatch(outcome))
    .catch(e => console.error('[ws] enregistrement du match échoué :', e.message));
}

// Lecture de l'Elo par défaut (production) depuis la base.
function defaultGetRating(userId, variant) {
  const { query } = require('../db');
  const { getRating } = require('../services/matchRecorder');
  return getRating(query, userId, variant);
}

/**
 * @param {http.Server} httpServer
 * @param {object} [opts]
 * @param {(outcome:object)=>void}        [opts.onMatchComplete]
 * @param {(userId,variant)=>Promise<number>} [opts.getRating]
 * @param {object} [opts.matchmaking]  options du Matchmaker
 * @param {number} [opts.tickMs]       période de la boucle d'appariement
 * @param {string} [opts.path]
 */
function attachWebSocketServer(httpServer, opts = {}) {
  const onMatchComplete = opts.onMatchComplete || defaultOnMatchComplete;
  const getRating = opts.getRating || defaultGetRating;
  const matchmaker = new Matchmaker(opts.matchmaking || {});
  const tickMs = opts.tickMs ?? 1000;

  const wss = new WebSocketServer({ server: httpServer, path: opts.path || '/ws' });

  // userId -> Set<ws> (un joueur peut avoir plusieurs onglets ; on diffuse à tous)
  const sockets = new Map();

  const addSocket = (userId, ws) => {
    if (!sockets.has(userId)) sockets.set(userId, new Set());
    sockets.get(userId).add(ws);
  };
  const removeSocket = (userId, ws) => {
    const set = sockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) sockets.delete(userId);
  };
  const notify = (userId, obj) => {
    const set = sockets.get(userId);
    if (set) for (const ws of set) send(ws, obj);
  };
  const pushStateTo = (userId, session) => {
    const set = sockets.get(userId);
    if (!set) return;
    const snap = session.snapshotFor(userId);
    for (const ws of set) send(ws, { t: 'state', state: snap });
  };
  const broadcast = (session) => {
    for (const p of session.players) pushStateTo(p.userId, session);
  };

  // ── Boucle d'appariement ──
  function onPair(a, b) {
    const session = registry.createSession({
      players: [{ userId: a.userId, name: a.name }, { userId: b.userId, name: b.name }],
      variant: a.variant,
      target: 3,
    });
    notify(a.userId, { t: 'matchFound', sessionId: session.id, opponent: b.name });
    notify(b.userId, { t: 'matchFound', sessionId: session.id, opponent: a.name });
    broadcast(session);
  }
  const timer = setInterval(() => {
    let pairs;
    try { pairs = matchmaker.findMatches(); }
    catch (e) { return console.error('[mm] appariement échoué :', e.message); }
    for (const [a, b] of pairs) onPair(a, b);
  }, tickMs);
  if (timer.unref) timer.unref(); // ne bloque pas l'arrêt du process / des tests

  // ── Gestion de la file ──
  function handleQueue(ws, user, msg) {
    if (msg.action === 'leave') {
      matchmaker.leave(user.id);
      return send(ws, { t: 'queue', status: 'left' });
    }
    if (msg.action === 'join') {
      if (registry.sessionForUser(user.id)) {
        return send(ws, { t: 'error', error: 'Une partie est déjà en cours.' });
      }
      const variant = msg.variant === 'mondoubleau' ? 'mondoubleau' : 'classic';
      Promise.resolve()
        .then(() => getRating(user.id, variant))
        .then((rating) => {
          matchmaker.join({ userId: user.id, name: user.username || 'Joueur', rating, variant });
          send(ws, { t: 'queue', status: 'searching', variant, rating });
        })
        .catch(() => send(ws, { t: 'error', error: 'File d’attente indisponible.' }));
      return;
    }
    send(ws, { t: 'error', error: 'Action de file inconnue.' });
  }

  // ── Connexions ──
  wss.on('connection', (ws, req) => {
    let user;
    try {
      const url = new URL(req.url, 'http://localhost');
      user = verifyToken(url.searchParams.get('token'));
    } catch { user = null; }
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
      try { msg = JSON.parse(raw.toString()); }
      catch { return send(ws, { t: 'error', error: 'JSON invalide.' }); }

      if (msg.t === 'queue') return handleQueue(ws, user, msg);

      const session = registry.sessionForUser(user.id);
      if (!session) return send(ws, { t: 'error', error: 'Aucune partie en cours.' });

      if (msg.t === 'sync') return pushStateTo(user.id, session);

      if (msg.t === 'action') {
        const res = session.applyAction(user.id, msg.action);
        if (!res.ok) send(ws, { t: 'error', error: res.error });
        broadcast(session); // rediffuse l'état (à jour ou inchangé) aux deux joueurs
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

    ws.on('close', () => { removeSocket(user.id, ws); matchmaker.leave(user.id); });
    ws.on('error', () => { removeSocket(user.id, ws); matchmaker.leave(user.id); });
  });

  function stop() {
    clearInterval(timer);
    wss.close();
  }

  return { wss, sockets, matchmaker, stop };
}

module.exports = { attachWebSocketServer };
