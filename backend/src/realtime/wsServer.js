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
//                       { t:'state', state } | { t:'error', error } |
//                       { t:'opponentDisconnected', deadline, graceMs } |
//                       { t:'opponentReconnected' }
//
// Abandon / reconnexion (#30) : à la fermeture du DERNIER socket d'un joueur en
// partie, un délai de grâce démarre (l'adversaire est prévenu). S'il revient à
// temps, la partie reprend ; sinon le match est clos par forfait (défaite Elo
// pleine). L'action { type:'forfeit' } permet d'abandonner volontairement.
//
// Défis entre amis (#45/#47) :
//   client → serveur : { t:'challenge', action:'invite', to, variant, rated } |
//                       { t:'challenge', action:'accept'|'decline'|'cancel', challengeId }
//   serveur → client : { t:'challenge', status:'sent'|'declined'|'expired'|'cancelled', ... }
//                       + notification kind:'challenge' chez le destinataire.
// L'invitation exige une amitié ACCEPTÉE ; l'acceptation crée la GameSession
// directement, sans file d'attente. `rated:false` = amicale, sans Elo.

const { randomUUID } = require('crypto');
const { WebSocketServer } = require('ws');
const { verifyToken } = require('../middleware/auth');
const registry = require('./sessionRegistry');
const { Matchmaker } = require('./matchmaking');
const presence = require('./presence');
const notifier = require('./notifier');

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

// Un défi (#45) n'est permis qu'entre amis acceptés. Injectable dans les tests.
async function defaultAreFriends(a, b) {
  const { query } = require('../db');
  const { rows } = await query(
    `SELECT 1 FROM friendships
     WHERE ((requester_id = $1 AND addressee_id = $2)
         OR (requester_id = $2 AND addressee_id = $1))
       AND status = 'accepted'`,
    [a, b]
  );
  return rows.length > 0;
}

/**
 * @param {http.Server} httpServer
 * @param {object} [opts]
 * @param {(outcome:object)=>void}        [opts.onMatchComplete]
 * @param {(userId,variant)=>Promise<number>} [opts.getRating]
 * @param {object} [opts.matchmaking]  options du Matchmaker
 * @param {number} [opts.tickMs]       période de la boucle d'appariement
 * @param {number} [opts.graceMs]      délai de grâce avant forfait sur déconnexion
 * @param {number} [opts.heartbeatMs]  période du ping de vie (0 = désactivé)
 * @param {(a,b)=>Promise<boolean>} [opts.areFriends]  contrôle d'amitié des défis
 * @param {number} [opts.challengeTtlMs] durée de vie d'un défi avant expiration
 * @param {(user)=>Promise<boolean>} [opts.validateUser] contrôle additionnel à la
 *   connexion (#117) — en production, server.js branche la vérification de la
 *   version de token en DB ; par défaut (tests), la signature seule suffit.
 * @param {string} [opts.path]
 */
function attachWebSocketServer(httpServer, opts = {}) {
  const onMatchComplete = opts.onMatchComplete || defaultOnMatchComplete;
  const getRating = opts.getRating || defaultGetRating;
  const areFriends = opts.areFriends || defaultAreFriends;
  const validateUser = opts.validateUser || (async () => true);
  const matchmaker = new Matchmaker(opts.matchmaking || {});
  const tickMs = opts.tickMs ?? 1000;
  const graceMs = opts.graceMs ?? 60000;
  const heartbeatMs = opts.heartbeatMs ?? 30000;
  const challengeTtlMs = opts.challengeTtlMs ?? 60000;
  // Rate-limit des messages entrants (#124) : seau à jetons par socket. Le jeu
  // normal (annonce + carte + sync) reste bien en dessous ; un flood est rejeté
  // sans traitement, et un abus soutenu ferme la connexion (borne le coût CPU
  // et l'amplification ×2 du rebroadcast).
  const msgRatePerSec = opts.msgRatePerSec ?? 20;
  const msgBurst = opts.msgBurst ?? 40;
  const msgFloodKick = opts.msgFloodKick ?? 100; // rejets consécutifs → fermeture

  // Consomme un jeton ; renvoie false si le socket dépasse son budget.
  function allowMessage(ws, now) {
    if (ws.msgTokens === undefined) {
      ws.msgTokens = msgBurst; ws.msgRefilledAt = now; ws.msgStrikes = 0;
    }
    const elapsed = now - ws.msgRefilledAt;
    if (elapsed > 0) {
      ws.msgTokens = Math.min(msgBurst, ws.msgTokens + (elapsed / 1000) * msgRatePerSec);
      ws.msgRefilledAt = now;
    }
    if (ws.msgTokens >= 1) { ws.msgTokens -= 1; ws.msgStrikes = 0; return true; }
    ws.msgStrikes += 1;
    return false;
  }

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
  notifier.setSender(notify); // les routes Express peuvent notifier (#44)
  const pushStateTo = (userId, session) => {
    const set = sockets.get(userId);
    if (!set) return;
    const snap = session.snapshotFor(userId);
    for (const ws of set) send(ws, { t: 'state', state: snap });
  };
  const broadcast = (session) => {
    for (const p of session.players) pushStateTo(p.userId, session);
  };

  const opponentOf = (session, userId) =>
    session.players.find(p => p.userId !== userId) || null;

  // ── Présence (#43) ──
  // Compteurs (jamais de noms) : joueurs connectés (dédupliqués par userId,
  // multi-onglets = 1), en file d'attente, en partie. Exposés aux routes via
  // le module presence, et diffusés aux connectés à chaque changement
  // (debounce court : une rafale de connexions ne produit qu'un message).
  const presenceStats = () => ({
    online: sockets.size,
    inQueue: matchmaker.totalSize(),
    inGame: registry.activeUserCount(),
  });
  presence.setProvider(presenceStats);
  // Présence individuelle (#46) — consommée par GET /api/friends (amis acceptés
  // uniquement) pour la pastille en ligne / en partie.
  presence.setUserProvider((userId) => ({
    online: sockets.has(userId),
    inGame: !!registry.sessionForUser(userId),
  }));

  let presenceTimer = null;
  function schedulePresence() {
    if (stopped || presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      const msg = { t: 'presence', ...presenceStats() };
      for (const set of sockets.values()) for (const ws of set) send(ws, msg);
    }, 250);
    if (presenceTimer.unref) presenceTimer.unref();
  }

  // ── Clôture de match (victoire normale ou forfait) ──
  function finishSession(session) {
    for (const p of session.players) cancelGrace(p.userId, { silent: true });
    const outcome = { sessionId: session.id, ...session.getMatchOutcome() };
    try { onMatchComplete(outcome); }
    catch (e) { console.error('[ws] onMatchComplete a échoué :', e.message); }
    registry.endSession(session.id);
    schedulePresence();
  }

  // ── Délai de grâce sur déconnexion (#30) ──
  // userId -> { timer, deadline } ; armé seulement quand le DERNIER socket d'un
  // joueur en partie se ferme (multi-onglets : les autres onglets le maintiennent).
  const graceTimers = new Map();
  let stopped = false; // après stop(), plus aucun forfait ne doit être armé

  function startGrace(userId) {
    if (stopped || graceTimers.has(userId)) return;
    const session = registry.sessionForUser(userId);
    if (!session || session.finished) return;

    const deadline = Date.now() + graceMs;
    const timer = setTimeout(() => {
      graceTimers.delete(userId);
      const s = registry.sessionForUser(userId);
      if (!s || s.finished || sockets.has(userId)) return;
      const res = s.forfeit(s.seatOf(userId), 'timeout');
      if (!res.ok) return;
      broadcast(s);
      finishSession(s);
    }, graceMs);
    if (timer.unref) timer.unref();
    graceTimers.set(userId, { timer, deadline });

    const opp = opponentOf(session, userId);
    if (opp) notify(opp.userId, { t: 'opponentDisconnected', deadline, graceMs });
  }

  function cancelGrace(userId, { silent = false } = {}) {
    const pending = graceTimers.get(userId);
    if (!pending) return;
    clearTimeout(pending.timer);
    graceTimers.delete(userId);
    if (silent) return;
    const session = registry.sessionForUser(userId);
    const opp = session ? opponentOf(session, userId) : null;
    if (opp) notify(opp.userId, { t: 'opponentReconnected' });
  }

  // Fermeture d'un socket : retrait de la file, et si c'était le dernier onglet
  // d'un joueur en partie, démarrage du délai de grâce avant forfait.
  function handleSocketGone(userId, ws) {
    removeSocket(userId, ws);
    if (sockets.has(userId)) return; // un autre onglet maintient la présence
    matchmaker.leave(userId);
    dropChallengesOf(userId); // les défis en attente tombent avec la connexion
    startGrace(userId);
    schedulePresence();
  }

  // ── Démarrage d'une partie (matchmaking ou défi accepté) ──
  function startMatch(a, b, { variant, rated = true } = {}) {
    matchmaker.leave(a.userId); // un défi accepté retire les deux joueurs de la file
    matchmaker.leave(b.userId);
    const session = registry.createSession({
      players: [{ userId: a.userId, name: a.name }, { userId: b.userId, name: b.name }],
      variant,
      target: 3,
      rated,
    });
    notify(a.userId, { t: 'matchFound', sessionId: session.id, opponent: b.name, rated });
    notify(b.userId, { t: 'matchFound', sessionId: session.id, opponent: a.name, rated });
    broadcast(session);
    schedulePresence();
  }

  // ── Boucle d'appariement ──
  function onPair(a, b) {
    startMatch(a, b, { variant: a.variant, rated: true });
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
      schedulePresence();
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
          schedulePresence();
        })
        .catch(() => send(ws, { t: 'error', error: 'File d’attente indisponible.' }));
      return;
    }
    send(ws, { t: 'error', error: 'Action de file inconnue.' });
  }

  // ── Défis entre amis (#45/#47) ──
  // challengeId -> { id, from, fromName, to, variant, rated, timer, expiresAt }.
  // En mémoire, comme la file (cf. #31 pour le multi-process).
  const challenges = new Map();

  const outgoingChallengeOf = (userId) => {
    for (const c of challenges.values()) if (c.from === userId) return c;
    return null;
  };

  function dropChallenge(c) {
    clearTimeout(c.timer);
    challenges.delete(c.id);
  }

  // Annule tout défi impliquant ce joueur (déconnexion totale) en prévenant l'autre.
  function dropChallengesOf(userId) {
    for (const c of [...challenges.values()]) {
      if (c.from === userId) {
        dropChallenge(c);
        notifier.notifyUser(c.to, { kind: 'challengeCancelled', challengeId: c.id });
      } else if (c.to === userId) {
        dropChallenge(c);
        notify(c.from, { t: 'challenge', status: 'cancelled', challengeId: c.id });
      }
    }
  }

  function handleChallenge(ws, user, msg) {
    if (msg.action === 'invite') {
      const to = typeof msg.to === 'string' ? msg.to : null;
      if (!to || to === user.id) return send(ws, { t: 'error', error: 'Destinataire invalide.' });
      if (registry.sessionForUser(user.id)) return send(ws, { t: 'error', error: 'Une partie est déjà en cours.' });
      if (registry.sessionForUser(to)) return send(ws, { t: 'error', error: 'Cet ami est déjà en partie.' });
      if (!sockets.has(to)) return send(ws, { t: 'error', error: 'Cet ami n’est pas en ligne.' });
      if (outgoingChallengeOf(user.id)) return send(ws, { t: 'error', error: 'Vous avez déjà un défi en attente.' });

      const variant = msg.variant === 'mondoubleau' ? 'mondoubleau' : 'classic';
      const rated = msg.rated === true; // défaut : amicale (#47)

      Promise.resolve()
        .then(() => areFriends(user.id, to))
        .then((ok) => {
          if (!ok) return send(ws, { t: 'error', error: 'Vous ne pouvez défier que vos amis.' });
          const id = randomUUID();
          const expiresAt = Date.now() + challengeTtlMs;
          const timer = setTimeout(() => {
            const c = challenges.get(id);
            if (!c) return;
            dropChallenge(c);
            notify(c.from, { t: 'challenge', status: 'expired', challengeId: id });
            notifier.notifyUser(c.to, { kind: 'challengeCancelled', challengeId: id });
          }, challengeTtlMs);
          if (timer.unref) timer.unref();
          challenges.set(id, { id, from: user.id, fromName: user.username || 'Joueur', to, variant, rated, timer, expiresAt });
          send(ws, { t: 'challenge', status: 'sent', challengeId: id, expiresAt, variant, rated });
          notifier.notifyUser(to, { kind: 'challenge', challengeId: id, from: user.username || 'Joueur', variant, rated, expiresAt });
        })
        .catch(() => send(ws, { t: 'error', error: 'Défi indisponible.' }));
      return;
    }

    const c = challenges.get(typeof msg.challengeId === 'string' ? msg.challengeId : '');
    if (!c) return send(ws, { t: 'error', error: 'Défi introuvable ou expiré.' });

    if (msg.action === 'accept') {
      if (c.to !== user.id) return send(ws, { t: 'error', error: 'Ce défi ne vous est pas destiné.' });
      if (registry.sessionForUser(c.from) || registry.sessionForUser(c.to)) {
        dropChallenge(c);
        return send(ws, { t: 'error', error: 'Un des joueurs est déjà en partie.' });
      }
      if (!sockets.has(c.from)) {
        dropChallenge(c);
        return send(ws, { t: 'error', error: 'Votre ami s’est déconnecté.' });
      }
      dropChallenge(c);
      startMatch(
        { userId: c.from, name: c.fromName },
        { userId: c.to, name: user.username || 'Joueur' },
        { variant: c.variant, rated: c.rated }
      );
      return;
    }
    if (msg.action === 'decline') {
      if (c.to !== user.id) return send(ws, { t: 'error', error: 'Ce défi ne vous est pas destiné.' });
      dropChallenge(c);
      return notify(c.from, { t: 'challenge', status: 'declined', challengeId: c.id });
    }
    if (msg.action === 'cancel') {
      if (c.from !== user.id) return send(ws, { t: 'error', error: 'Ce défi n’est pas le vôtre.' });
      dropChallenge(c);
      return notifier.notifyUser(c.to, { kind: 'challengeCancelled', challengeId: c.id });
    }
    send(ws, { t: 'error', error: 'Action de défi inconnue.' });
  }

  // ── Connexions ──
  wss.on('connection', async (ws, req) => {
    let user;
    try {
      const url = new URL(req.url, 'http://localhost');
      user = verifyToken(url.searchParams.get('token'));
    } catch { user = null; }
    // Vérification additionnelle (#117) : version de token révoquée → refus,
    // comme une signature invalide. Fail-closed sur erreur de vérification.
    if (user) {
      try { if (!(await validateUser(user))) user = null; }
      catch { user = null; }
    }
    if (!user) {
      send(ws, { t: 'error', error: 'Authentification requise.' });
      ws.close(4001, 'unauthorized');
      return;
    }
    ws.userId = user.id;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    addSocket(user.id, ws);

    // Reprise : si une partie est en cours pour ce joueur, on lui renvoie l'état
    // et on désarme l'éventuel forfait en attente (l'adversaire est prévenu).
    // `inSession` permet à un client qui se croyait en partie de découvrir
    // qu'elle s'est terminée pendant son absence (forfait déjà prononcé).
    cancelGrace(user.id);
    const existing = registry.sessionForUser(user.id);
    send(ws, { t: 'hello', userId: user.id, inSession: !!existing });
    send(ws, { t: 'presence', ...presenceStats() }); // état immédiat, sans attendre la diffusion
    if (existing) pushStateTo(user.id, existing);
    schedulePresence();

    ws.on('message', (raw) => {
      // Rate-limit (#124) : au-delà du budget, on rejette sans rien traiter ;
      // un flood soutenu ferme la connexion (évite l'amplification du broadcast).
      if (!allowMessage(ws, Date.now())) {
        if (ws.msgStrikes >= msgFloodKick) return ws.close(4002, 'rate-limit');
        return send(ws, { t: 'error', error: 'Trop de messages. Ralentissez.', code: 'RATE_LIMIT' });
      }

      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return send(ws, { t: 'error', error: 'JSON invalide.' }); }

      if (msg.t === 'queue') return handleQueue(ws, user, msg);
      if (msg.t === 'challenge') return handleChallenge(ws, user, msg);

      const session = registry.sessionForUser(user.id);
      if (!session) return send(ws, { t: 'error', error: 'Aucune partie en cours.' });

      if (msg.t === 'sync') return pushStateTo(user.id, session);

      if (msg.t === 'action') {
        const res = session.applyAction(user.id, msg.action);
        if (!res.ok) send(ws, { t: 'error', error: res.error });
        broadcast(session); // rediffuse l'état (à jour ou inchangé) aux deux joueurs
        if (session.finished) finishSession(session);
        return;
      }
      send(ws, { t: 'error', error: 'Message inconnu.' });
    });

    ws.on('close', () => handleSocketGone(user.id, ws));
    ws.on('error', () => handleSocketGone(user.id, ws));
  });

  // ── Heartbeat ──
  // Détecte les connexions mortes que TCP ne signale pas (mobile, veille) : un
  // socket qui ne répond pas au ping est terminé, ce qui déclenche le délai de
  // grâce comme une déconnexion ordinaire.
  let heartbeat = null;
  if (heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        ws.ping();
      }
    }, heartbeatMs);
    if (heartbeat.unref) heartbeat.unref();
  }

  function stop() {
    stopped = true;
    clearInterval(timer);
    if (heartbeat) clearInterval(heartbeat);
    if (presenceTimer) { clearTimeout(presenceTimer); presenceTimer = null; }
    for (const { timer: t } of graceTimers.values()) clearTimeout(t);
    graceTimers.clear();
    for (const c of challenges.values()) clearTimeout(c.timer);
    challenges.clear();
    for (const ws of wss.clients) ws.terminate(); // ne pas laisser de connexions pendantes
    wss.close();
  }

  return { wss, sockets, matchmaker, stop };
}

module.exports = { attachWebSocketServer };
