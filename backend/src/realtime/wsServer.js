'use strict';

// ─── Serveur WebSocket PvP — multi-instance via Redis (#31) ───────────────────
// Attache un serveur WebSocket (`ws`) au serveur HTTP, sur `/ws`. Authentifie
// via le JWT (query `?token=`). L'état temps-réel (file, sessions, présence,
// défis) vit dans Redis : N instances peuvent tourner derrière le reverse-proxy.
//
// Modèle « stateless + sweep » :
//   - Aucune session en mémoire : chaque coup est appliqué sous verrou Redis
//     (charge → applyAction → sauvegarde), donc n'importe quelle instance traite
//     n'importe quel coup, et les parties survivent à un redéploiement.
//   - Livraison via le bus pub/sub : une instance publie un snapshot, toutes le
//     reçoivent et le remettent à leurs sockets locaux (le destinataire peut être
//     connecté à une autre instance).
//   - Les timers (horloge #141, grâce #30, expiration des défis #45) ne sont plus
//     des setTimeout par instance mais des deadlines Redis balayées par un sweep
//     périodique sous verrou (une instance à la fois).
//
// Protocole (JSON) — inchangé :
//   client → serveur : { t:'queue', action, variant } | { t:'action', action } |
//                       { t:'sync' } | { t:'challenge', action, ... }
//   serveur → client : { t:'hello'|'queue'|'matchFound'|'state'|'error'|
//                        'presence'|'opponentDisconnected'|'opponentReconnected'|
//                        'challenge' , ... }

const { randomUUID } = require('crypto');
const { WebSocketServer } = require('ws');
const { verifyToken } = require('../middleware/auth');
const config = require('../config');
const ticketStore = require('./ticketStore');
const sessionStore = require('./sessionStore');
const matchmakingStore = require('./matchmakingStore');
const presenceStore = require('./presenceStore');
const bus = require('./bus');
const notifier = require('./notifier');
const accountRemoval = require('./accountRemoval');
const turnClock = require('../game/turnClock');
const { getClient } = require('../redis/client');
const { logger } = require('../logger');

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

// Persistance classée par défaut (production) : enregistre le match et met à
// jour l'Elo. Injectable dans les tests pour éviter la DB.
function defaultOnMatchComplete(outcome) {
  const { recordMatch } = require('../services/matchRecorder');
  // Promesse renvoyée : la suppression de compte (#238) doit attendre
  // l'enregistrement, les autres appelants l'ignorent.
  return Promise.resolve()
    .then(() => recordMatch(outcome))
    .catch(err => logger.error({ err, sessionId: outcome.sessionId }, 'ws: enregistrement du match échoué'));
}

function defaultGetRating(userId, variant) {
  const { query } = require('../db');
  const { getRating } = require('../services/matchRecorder');
  return getRating(query, userId, variant);
}

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

// Verrou non bloquant pour les boucles (appariement, sweep) : une seule instance
// agit par tick ; le TTL le libère même si l'instance meurt.
async function tryLock(key, ttlMs) {
  const token = randomUUID();
  const ok = await getClient().set(key, token, 'PX', ttlMs, 'NX');
  if (!ok) return null;
  return async () => {
    try { if (await getClient().get(key) === token) await getClient().del(key); }
    catch { /* expiré */ }
  };
}

// Clés des défis (#45) dans Redis.
const CK = {
  chal: (id) => `chal:${id}`,
  from: (uid) => `chal:from:${uid}`,
  ids: 'chal:ids',
};

// Compte en cours de suppression (#238) : marqueur partagé entre instances qui
// bloque toute nouvelle entrée temps-réel (connexion, file, défi). Le TTL couvre
// la suppression et la fermeture des sockets ; ensuite, le compte n'existant
// plus, validateUser refuse les connexions.
const DELETING = (uid) => `acct:deleting:${uid}`;
const DELETING_TTL_MS = 60_000;
const isBeingDeleted = async (uid) => (await getClient().exists(DELETING(uid))) === 1;

// Fermeture WebSocket : le compte n'existe plus, le client ne doit pas se
// reconnecter (4001 = non authentifié, 4002 = flood).
const WS_CLOSE_ACCOUNT_DELETED = 4003;

/**
 * @param {http.Server} httpServer
 * @param {object} [opts]  voir les valeurs par défaut ci-dessous.
 * @returns {Promise<{wss, sockets, stop}>}
 */
async function attachWebSocketServer(httpServer, opts = {}) {
  const onMatchComplete = opts.onMatchComplete || defaultOnMatchComplete;
  const getRating = opts.getRating || defaultGetRating;
  const areFriends = opts.areFriends || defaultAreFriends;
  const validateUser = opts.validateUser || (async () => true);
  const mmParams = { ...matchmakingStore.DEFAULT_PARAMS, ...(opts.matchmaking || {}) };
  const tickMs = opts.tickMs ?? 1000;
  const sweepMs = opts.sweepMs ?? tickMs;
  const graceMs = opts.graceMs ?? 60000;
  // Délai d'inactivité pendant la coupe (#201) : un joueur qui ne pioche pas
  // dans ce délai perd par forfait (l'adversaire gagne).
  const cutMs = opts.cutMs ?? 15000;
  // Durée d'affichage des cartes en phase de révélation (#201) : une fois les
  // deux sièges tirés, les cartes restent visibles ce temps-là (avec « qui
  // commence ») avant que la 1ʳᵉ main soit distribuée.
  const revealMs = opts.revealMs ?? 2000;
  const heartbeatMs = opts.heartbeatMs ?? 30000;
  const challengeTtlMs = opts.challengeTtlMs ?? 60000;
  const msgRatePerSec = opts.msgRatePerSec ?? 20;
  const msgBurst = opts.msgBurst ?? 40;
  const msgFloodKick = opts.msgFloodKick ?? 100;
  // Messages gardés en attente pendant l'établissement de la connexion (#298) :
  // très au-delà de ce qu'envoie un vrai client. Au-delà, le socket est fermé.
  const pendingMaxMessages = opts.pendingMaxMessages ?? 32;
  const pendingMaxBytes = opts.pendingMaxBytes ?? 64 * 1024;
  const clockOptions = opts.clockOptions;

  let stopped = false;

  function allowMessage(ws, now) {
    if (ws.msgTokens === undefined) { ws.msgTokens = msgBurst; ws.msgRefilledAt = now; ws.msgStrikes = 0; }
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

  // ── Sockets LOCAUX à cette instance ──
  const sockets = new Map(); // userId -> Set<ws>
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
  const deliverLocal = (userId, obj) => {
    const set = sockets.get(userId);
    if (set) for (const ws of set) send(ws, obj);
  };

  // ── Bus pub/sub : livraison cross-instance ──
  const offBus = bus.onMessage((m) => {
    if (m.kind === 'user') deliverLocal(m.userId, m.obj);
    else if (m.kind === 'closeUser') {
      for (const ws of sockets.get(m.userId) || []) ws.close(WS_CLOSE_ACCOUNT_DELETED, 'account-deleted');
    }
    else if (m.kind === 'presence') {
      const msg = { t: 'presence', ...m.counts };
      for (const set of sockets.values()) for (const ws of set) send(ws, msg);
    }
  });
  await bus.start();

  // Notifie un joueur où qu'il soit connecté (publie ; chaque instance livre en local).
  const notify = (userId, obj) => { bus.publish({ kind: 'user', userId, obj }).catch(() => {}); };
  notifier.setSender(notify); // les routes Express notifient via le bus (#44)

  const broadcastSession = (session) => {
    for (const p of session.players) notify(p.userId, { t: 'state', state: session.snapshotFor(p.userId) });
  };
  const opponentOf = (session, userId) => session.players.find(p => p.userId !== userId) || null;

  // ── Présence (#43) : compteurs agrégés Redis, diffusés (debounce) ──
  let presenceTimer = null;
  function schedulePresence() {
    if (stopped || presenceTimer) return;
    presenceTimer = setTimeout(async () => {
      presenceTimer = null;
      try { bus.publish({ kind: 'presence', counts: await presenceStore.counts() }).catch(() => {}); }
      catch { /* Redis indisponible : on retentera au prochain changement */ }
    }, 250);
    if (presenceTimer.unref) presenceTimer.unref();
  }

  // ── Horloge de coup (#141) — pure, pilotée par l'état Redis ──
  // Siège déconnecté (en grâce), ou -1.
  async function disconnectedSeat(session) {
    for (let seat = 0; seat < session.players.length; seat++) {
      if ((await presenceStore.getGrace(session.players[seat].userId)) !== null) return seat;
    }
    return -1;
  }
  // Aligne l'horloge sur le tour courant après un coup. `dseat` = siège déconnecté.
  function syncClock(session, dseat) {
    if (!session.clock) return;
    const now = Date.now();
    // L'horloge de coup ne tourne pas pendant la coupe (#201) : les phases `cut`
    // (échéance cutDeadline) et `cutReveal` (échéance revealDeadline) ont leurs
    // propres échéances ; l'horloge ne démarre qu'à la 1ʳᵉ donne.
    if (session.finished || session.state.handOver
        || session.state.phase === 'cut' || session.state.phase === 'cutReveal') {
      session.clock.seat = null; session.clock.deadline = null; session.clock.paused = false; return;
    }
    if (session.clock.paused) turnClock.resume(session.clock, now);
    const turn = session.state.turn;
    if (session.clock.seat !== turn) {
      if (session.clock.seat !== null) turnClock.commitMove(session.clock, now);
      turnClock.startTurn(session.clock, turn, now);
    }
    if (dseat >= 0 && !session.clock.paused) turnClock.pause(session.clock, dseat, now);
  }

  // Aligne l'échéance de la coupe (#201) sur l'état : armée tant qu'il reste un
  // siège à servir en phase `cut`, effacée dès qu'on en sort. Rafraîchie à
  // chaque pioche (le délai redémarre pour le siège restant).
  function syncCutDeadline(session) {
    if (session.finished || session.state.phase !== 'cut') {
      session.cutDeadline = null;
      return;
    }
    session.cutDeadline = Date.now() + cutMs;
  }

  // Aligne l'échéance de révélation (#201) sur l'état : armée à l'entrée en
  // phase `cutReveal` (si elle ne l'est pas déjà — ne pas la repousser à chaque
  // sync, sinon les cartes resteraient indéfiniment), effacée hors de cette
  // phase. Au passage à `draw`, c'est `finishReveal` qui la remet à null.
  function syncRevealDeadline(session) {
    if (session.finished || session.state.phase !== 'cutReveal') {
      session.revealDeadline = null;
      return;
    }
    if (session.revealDeadline === null) session.revealDeadline = Date.now() + revealMs;
  }

  // ── Clôture de match (victoire ou forfait) ──
  async function finishSession(session) {
    for (const p of session.players) await presenceStore.clearGrace(p.userId);
    const outcome = { sessionId: session.id, ...session.getMatchOutcome() };
    let recording = null;
    try { recording = onMatchComplete(outcome); }
    catch (err) { logger.error({ err, sessionId: session.id }, 'ws: onMatchComplete a échoué'); }
    await sessionStore.endSession(session.id);
    schedulePresence();
    return { recording };
  }

  // ── Suppression de compte (#238) ──
  // Forfait de la partie en cours, sous verrou comme tout forfait. Attend
  // l'enregistrement du match, hors verrou.
  async function forfeitForDeletion(userId) {
    const sid = await sessionStore.sessionIdForUser(userId);
    if (!sid) return;
    let recording = null;
    await sessionStore.withLock(sid, async () => {
      const s = await sessionStore.getSession(sid);
      if (!s || s.finished) return;
      if (!s.forfeit(s.seatOf(userId), 'abandon').ok) return;
      await sessionStore.save(s);
      broadcastSession(s);
      ({ recording } = await finishSession(s));
    });
    await recording;
  }

  // Sort le joueur du temps réel puis exécute `deleteAccount`. L'ordre compte :
  //   1. le marqueur empêche de rentrer en file ou d'ouvrir un défi entre-temps ;
  //   2. le match est enregistré AVANT la suppression : il faut les deux comptes
  //      pour calculer l'Elo de l'adversaire et inscrire la défaite, que le
  //      trigger anonymise ensuite ;
  //   3. les sockets ne sont fermés qu'une fois le compte supprimé : si la
  //      suppression échoue, le joueur n'est pas déconnecté.
  // En cas d'échec, le forfait éventuel reste acquis : l'utilisateur peut réessayer.
  async function removeAccount(userId, deleteAccount) {
    const r = getClient();
    await r.set(DELETING(userId), '1', 'PX', DELETING_TTL_MS);
    try {
      await matchmakingStore.leave(userId);
      await dropChallengesOf(userId);
      await forfeitForDeletion(userId);
      schedulePresence();
      await deleteAccount();
    } catch (err) {
      await r.del(DELETING(userId)).catch(() => {});
      throw err;
    }
    // Compte déjà supprimé : une panne Redis ici ne doit pas faire échouer la requête.
    await bus.publish({ kind: 'closeUser', userId })
      .catch(err => logger.error({ err, userId }, 'ws: fermeture des sockets du compte supprimé échouée'));
  }
  accountRemoval.setHandler(removeAccount);

  // ── Démarrage d'une partie (appariement ou défi) ──
  async function startMatch(a, b, { variant, rated = true } = {}) {
    await matchmakingStore.leave(a.userId);
    await matchmakingStore.leave(b.userId);
    const session = await sessionStore.createSession({
      players: [{ userId: a.userId, name: a.name }, { userId: b.userId, name: b.name }],
      variant, target: 3, rated, clockOptions,
    });
    syncClock(session, -1); // démarre l'horloge du premier coup (#141)
    syncCutDeadline(session); // arme l'échéance de la coupe (#201)
    await sessionStore.save(session);
    notify(a.userId, { t: 'matchFound', sessionId: session.id, opponent: b.name, rated });
    notify(b.userId, { t: 'matchFound', sessionId: session.id, opponent: a.name, rated });
    broadcastSession(session);
    schedulePresence();
  }

  // ── Boucle d'appariement (une instance à la fois) ──
  const tickTimer = setInterval(async () => {
    if (stopped) return;
    const release = await tryLock('mm:lock', tickMs).catch(() => null);
    if (!release) return;
    try {
      const pairs = await matchmakingStore.findMatches(mmParams);
      for (const [a, b] of pairs) await startMatch(a, b, { variant: a.variant, rated: true });
    } catch (err) { logger.error({ err }, 'mm: appariement échoué'); }
    finally { await release(); }
  }, tickMs);
  if (tickTimer.unref) tickTimer.unref();

  // ── Sweep des deadlines (horloge + grâce), une instance à la fois ──
  const sweepTimer = setInterval(() => { sweepOnce().catch(err => logger.error({ err }, 'sweep échoué')); }, sweepMs);
  if (sweepTimer.unref) sweepTimer.unref();

  async function sweepOnce() {
    if (stopped) return;
    const release = await tryLock('sweep:lock', sweepMs).catch(() => null);
    if (!release) return;
    try {
      // Grâces expirées → forfait.
      for (const uid of await presenceStore.listGraces()) {
        const g = await presenceStore.getGrace(uid);
        if (g === null) continue;
        if (await presenceStore.isOnline(uid)) { await presenceStore.clearGrace(uid); continue; }
        if (Date.now() < g) continue;
        const sid = await sessionStore.sessionIdForUser(uid);
        if (!sid) { await presenceStore.clearGrace(uid); continue; }
        await sessionStore.withLock(sid, async () => {
          const s = await sessionStore.getSession(sid);
          if (!s || s.finished) return;
          if (!s.forfeit(s.seatOf(uid), 'timeout').ok) return;
          await sessionStore.save(s);
          broadcastSession(s);
          await finishSession(s);
        });
      }
      // Coupe (#201) : un siège qui ne pioche pas avant l'échéance perd par
      // forfait. La phase `cut` précède toute donne ; l'horloge de coup n'y
      // tourne pas encore, d'où ce balayage dédié.
      for (const sid of await sessionStore.listActiveSessionIds()) {
        await sessionStore.withLock(sid, async () => {
          const s = await sessionStore.getSession(sid);
          if (!s || s.finished || s.state.phase !== 'cut' || s.cutDeadline === null) return;
          if (Date.now() < s.cutDeadline) return;
          const res = s.cutTimeout();
          if (!res.ok) return;
          await sessionStore.save(s);
          broadcastSession(s);
          await finishSession(s);
        });
      }
      // Révélation de la coupe (#201) : une fois l'échéance d'affichage atteinte,
      // on distribue la 1ʳᵉ main (transition `cutReveal` → `draw`) et on diffuse
      // le nouvel état. L'horloge de coup démarre alors via syncClock.
      for (const sid of await sessionStore.listActiveSessionIds()) {
        await sessionStore.withLock(sid, async () => {
          const s = await sessionStore.getSession(sid);
          if (!s || s.finished || s.state.phase !== 'cutReveal' || s.revealDeadline === null) return;
          if (Date.now() < s.revealDeadline) return;
          if (!s.finishReveal().ok) return;
          const dseat = await disconnectedSeat(s);
          syncClock(s, dseat); // l'horloge de coup démarre à la 1ʳᵉ donne
          await sessionStore.save(s);
          broadcastSession(s);
        });
      }
      // Horloges : pause/reprise selon présence, puis expiration.
      for (const sid of await sessionStore.listActiveSessionIds()) {
        await sessionStore.withLock(sid, async () => {
          const s = await sessionStore.getSession(sid);
          if (!s || !s.clock || s.finished || s.state.handOver || s.clock.seat === null) return;
          const now = Date.now();
          const dseat = await disconnectedSeat(s);
          let changed = false;
          if (dseat >= 0 && !s.clock.paused) { if (turnClock.pause(s.clock, dseat, now)) changed = true; }
          else if (dseat < 0 && s.clock.paused) { turnClock.resume(s.clock, now); changed = true; }
          if (turnClock.isExpired(s.clock, now)) {
            const res = s.clockTimeout(now);
            if (res.ok) {
              if (s.finished) { await sessionStore.save(s); broadcastSession(s); await finishSession(s); return; }
              syncClock(s, dseat); await sessionStore.save(s); broadcastSession(s); return;
            }
          }
          if (changed) await sessionStore.save(s);
        });
      }
      // Défis expirés (#45) : préviens le défieur et le destinataire, puis purge.
      for (const id of await getClient().smembers(CK.ids)) {
        const c = await getClient().hgetall(CK.chal(id));
        if (!c || !c.from) { await getClient().srem(CK.ids, id); continue; }
        if (Number(c.expiresAt) > Date.now()) continue;
        await dropChallenge(id, c.from);
        notify(c.from, { t: 'challenge', status: 'expired', challengeId: id });
        notifier.notifyUser(c.to, { kind: 'challengeCancelled', challengeId: id });
      }
    } finally { await release(); }
  }

  // ── File d'attente ──
  async function handleQueue(ws, user, msg) {
    if (msg.action === 'leave') {
      await matchmakingStore.leave(user.id);
      schedulePresence();
      return send(ws, { t: 'queue', status: 'left' });
    }
    if (msg.action === 'join') {
      if (await isBeingDeleted(user.id)) return send(ws, { t: 'error', error: 'Compte en cours de suppression.' });
      if (await sessionStore.sessionIdForUser(user.id)) {
        return send(ws, { t: 'error', error: 'Une partie est déjà en cours.' });
      }
      const variant = msg.variant === 'mondoubleau' ? 'mondoubleau' : 'classic';
      try {
        const rating = await getRating(user.id, variant);
        await matchmakingStore.join({ userId: user.id, name: user.username || 'Joueur', rating, variant });
        send(ws, { t: 'queue', status: 'searching', variant, rating });
        schedulePresence();
      } catch { send(ws, { t: 'error', error: 'File d’attente indisponible.' }); }
      return;
    }
    send(ws, { t: 'error', error: 'Action de file inconnue.' });
  }

  // ── Défis entre amis (#45/#47) — état dans Redis ──
  async function outgoingChallengeOf(userId) {
    const id = await getClient().get(CK.from(userId));
    return id ? { id, ...(await getClient().hgetall(CK.chal(id))) } : null;
  }
  async function dropChallenge(id, from) {
    const r = getClient();
    await r.del(CK.chal(id));
    if (from) await r.del(CK.from(from));
    await r.srem(CK.ids, id);
  }
  async function dropChallengesOf(userId) {
    for (const id of await getClient().smembers(CK.ids)) {
      const c = await getClient().hgetall(CK.chal(id));
      if (!c || !c.from) { await getClient().srem(CK.ids, id); continue; }
      if (c.from === userId) { await dropChallenge(id, c.from); notifier.notifyUser(c.to, { kind: 'challengeCancelled', challengeId: id }); }
      else if (c.to === userId) { await dropChallenge(id, c.from); notify(c.from, { t: 'challenge', status: 'cancelled', challengeId: id }); }
    }
  }

  async function handleChallenge(ws, user, msg) {
    if ((msg.action === 'invite' || msg.action === 'accept') && await isBeingDeleted(user.id)) {
      return send(ws, { t: 'error', error: 'Compte en cours de suppression.' });
    }
    if (msg.action === 'invite') {
      const to = typeof msg.to === 'string' ? msg.to : null;
      if (!to || to === user.id) return send(ws, { t: 'error', error: 'Destinataire invalide.' });
      // Conditions sur SOI (ne fuitent rien sur autrui).
      if (await sessionStore.sessionIdForUser(user.id)) return send(ws, { t: 'error', error: 'Une partie est déjà en cours.' });
      if (await outgoingChallengeOf(user.id)) return send(ws, { t: 'error', error: 'Vous avez déjà un défi en attente.' });
      const variant = msg.variant === 'mondoubleau' ? 'mondoubleau' : 'classic';
      const rated = msg.rated === true;
      try {
        // SÉCURITÉ (#123) : vérifier l'amitié AVANT tout test sur le statut de
        // `to`, sinon des messages d'erreur différents (en ligne / en partie /
        // hors ligne) permettent de sonder la présence de n'importe quel userId
        // (les UUID sont publics via la recherche). Un non-ami reçoit toujours la
        // même réponse, quel que soit son état.
        if (!(await areFriends(user.id, to))) return send(ws, { t: 'error', error: 'Vous ne pouvez défier que vos amis.' });
        if (await sessionStore.sessionIdForUser(to)) return send(ws, { t: 'error', error: 'Cet ami est déjà en partie.' });
        if (!(await presenceStore.isOnline(to))) return send(ws, { t: 'error', error: 'Cet ami n’est pas en ligne.' });
        const id = randomUUID();
        const expiresAt = Date.now() + challengeTtlMs;
        const r = getClient();
        await r.hset(CK.chal(id), { id, from: user.id, fromName: user.username || 'Joueur', to, variant, rated: rated ? '1' : '', expiresAt });
        await r.set(CK.from(user.id), id);
        await r.sadd(CK.ids, id);
        send(ws, { t: 'challenge', status: 'sent', challengeId: id, expiresAt, variant, rated });
        notifier.notifyUser(to, { kind: 'challenge', challengeId: id, from: user.username || 'Joueur', variant, rated, expiresAt });
      } catch { send(ws, { t: 'error', error: 'Défi indisponible.' }); }
      return;
    }

    const id = typeof msg.challengeId === 'string' ? msg.challengeId : '';
    const c = await getClient().hgetall(CK.chal(id));
    if (!c || !c.from) return send(ws, { t: 'error', error: 'Défi introuvable ou expiré.' });
    c.rated = c.rated === '1';

    if (msg.action === 'accept') {
      if (c.to !== user.id) return send(ws, { t: 'error', error: 'Ce défi ne vous est pas destiné.' });
      if (await sessionStore.sessionIdForUser(c.from) || await sessionStore.sessionIdForUser(c.to)) {
        await dropChallenge(id, c.from);
        return send(ws, { t: 'error', error: 'Un des joueurs est déjà en partie.' });
      }
      if (!(await presenceStore.isOnline(c.from))) {
        await dropChallenge(id, c.from);
        return send(ws, { t: 'error', error: 'Votre ami s’est déconnecté.' });
      }
      await dropChallenge(id, c.from);
      await startMatch({ userId: c.from, name: c.fromName }, { userId: c.to, name: user.username || 'Joueur' }, { variant: c.variant, rated: c.rated });
      return;
    }
    if (msg.action === 'decline') {
      if (c.to !== user.id) return send(ws, { t: 'error', error: 'Ce défi ne vous est pas destiné.' });
      await dropChallenge(id, c.from);
      return notify(c.from, { t: 'challenge', status: 'declined', challengeId: id });
    }
    if (msg.action === 'cancel') {
      if (c.from !== user.id) return send(ws, { t: 'error', error: 'Ce défi n’est pas le vôtre.' });
      await dropChallenge(id, c.from);
      return notifier.notifyUser(c.to, { kind: 'challengeCancelled', challengeId: id });
    }
    send(ws, { t: 'error', error: 'Action de défi inconnue.' });
  }

  // ── Action de jeu (sous verrou de session) ──
  async function handleAction(ws, user, action) {
    const sid = await sessionStore.sessionIdForUser(user.id);
    if (!sid) return send(ws, { t: 'error', error: 'Aucune partie en cours.' });
    let result = null;
    await sessionStore.withLock(sid, async () => {
      const session = await sessionStore.getSession(sid);
      if (!session) { result = { error: 'Aucune partie en cours.' }; return; }
      const res = session.applyAction(user.id, action);
      if (res.ok) {
        const dseat = await disconnectedSeat(session);
        syncClock(session, dseat);
        syncCutDeadline(session); // rafraîchit/efface l'échéance de coupe (#201)
        syncRevealDeadline(session); // arme l'échéance de révélation si on y entre (#201)
      }
      await sessionStore.save(session);
      result = { res, session };
    });
    if (!result) return;
    if (result.error) return send(ws, { t: 'error', error: result.error });
    if (!result.res.ok) send(ws, { t: 'error', error: result.res.error });
    broadcastSession(result.session);
    if (result.session.finished) await finishSession(result.session);
  }

  // Traite un message d'un client authentifié. Ne rejette jamais.
  function routeMessage(ws, user, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { send(ws, { t: 'error', error: 'JSON invalide.' }); return Promise.resolve(); }

    const route = (async () => {
      if (msg.t === 'queue') return handleQueue(ws, user, msg);
      if (msg.t === 'challenge') return handleChallenge(ws, user, msg);
      if (msg.t === 'sync') {
        const s = await sessionStore.sessionForUser(user.id);
        if (!s) return send(ws, { t: 'error', error: 'Aucune partie en cours.' });
        return send(ws, { t: 'state', state: s.snapshotFor(user.id) });
      }
      if (msg.t === 'action') return handleAction(ws, user, msg.action);
      send(ws, { t: 'error', error: 'Message inconnu.' });
    })();
    return route.catch(err => logger.error({ err }, 'ws: traitement message échoué'));
  }

  // ── Connexions ──
  wss.on('connection', async (ws, req) => {
    let user = null;
    // Un client peut écrire dès `open` (#298) : tout est attaché AVANT le premier
    // await, et ses messages attendent ici la fin de l'authentification et de la
    // mise en ligne. Ils sont traités un par un, car les traitements sont
    // asynchrones : en parallèle, un `leave` pourrait doubler le `join` qui le
    // précède.
    let pending = [];
    let pendingBytes = 0;
    const dropPending = () => { pending = []; pendingBytes = 0; };
    let live = false;       // la file est vidée : traitement direct des messages
    let settled = false;    // connexion établie et file vidée
    let socketGone = false;

    const releaseSocket = () => handleSocketGone(user.id, ws).catch(err => logger.error({ err }, 'ws: fermeture échouée'));
    const onGone = () => {
      if (socketGone) return; // `error` est suivi de `close`
      socketGone = true;
      dropPending();
      // Pendant l'établissement, le nettoyage attend la fin des étapes en cours.
      // Sinon, un `join` en cours remettrait en file un joueur déjà parti, et la
      // reprise annulerait la grâce qui vient d'être armée.
      if (settled) releaseSocket();
    };
    ws.on('close', onGone);
    ws.on('error', onGone);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      if (ws.readyState !== ws.OPEN) return; // fermeture demandée : plus rien à traiter
      // Anti-flood (#124) à l'arrivée, y compris pendant l'attente.
      if (!allowMessage(ws, Date.now())) {
        if (ws.msgStrikes >= msgFloodKick) return ws.close(4002, 'rate-limit');
        return send(ws, { t: 'error', error: 'Trop de messages. Ralentissez.', code: 'RATE_LIMIT' });
      }
      if (live) { routeMessage(ws, user, raw); return; }
      if (pending.length >= pendingMaxMessages || pendingBytes + raw.length > pendingMaxBytes) {
        dropPending();
        return ws.close(4002, 'pending-overflow');
      }
      pending.push(raw);
      pendingBytes += raw.length;
    });

    try {
      const url = new URL(req.url, 'http://localhost');
      // #120 : auth par TICKET éphémère (le JWT ne doit plus être dans l'URL).
      // Le `?token=` reste accepté HORS production (dev/tests) pour la simplicité.
      const ticket = url.searchParams.get('ticket');
      if (ticket) user = await ticketStore.consume(ticket);
      else if (!config.isProd) user = verifyToken(url.searchParams.get('token'));
    } catch { user = null; }
    if (user) {
      try { if (!(await validateUser(user)) || await isBeingDeleted(user.id)) user = null; } catch { user = null; }
    }
    // Parti ou exclu pendant l'attente : rien n'a encore été enregistré.
    if (ws.readyState !== ws.OPEN) return;
    if (!user) {
      dropPending();
      send(ws, { t: 'error', error: 'Authentification requise.' });
      ws.close(4001, 'unauthorized');
      return;
    }
    ws.userId = user.id;
    addSocket(user.id, ws);

    try {
      await presenceStore.addOnline(user.id);

      // Reprise : annule un éventuel forfait en attente, prévient l'adversaire.
      const hadGrace = (await presenceStore.getGrace(user.id)) !== null;
      if (hadGrace) await presenceStore.clearGrace(user.id);
      const sid = await sessionStore.sessionIdForUser(user.id);
      if (hadGrace && sid) {
        const s = await sessionStore.getSession(sid);
        const opp = s ? opponentOf(s, user.id) : null;
        if (opp) notify(opp.userId, { t: 'opponentReconnected' });
      }
      send(ws, { t: 'hello', userId: user.id, inSession: !!sid });
      send(ws, { t: 'presence', ...(await presenceStore.counts()) });
      if (sid) {
        const s = await sessionStore.getSession(sid);
        if (s) send(ws, { t: 'state', state: s.snapshotFor(user.id) });
      }
      schedulePresence();

      // Un message reçu pendant ce traitement rejoint la file et attend son tour.
      while (pending.length > 0 && ws.readyState === ws.OPEN) {
        const raw = pending.shift();
        pendingBytes -= raw.length;
        await routeMessage(ws, user, raw);
      }
      dropPending();
      live = true;
    } catch (err) {
      // La connexion n'est pas utilisable : le client doit se reconnecter.
      logger.error({ err }, 'ws: établissement de la connexion échoué');
      dropPending();
      ws.close(1011, 'setup-failed');
    }
    settled = true;
    if (socketGone) releaseSocket();
  });

  // Fermeture d'un socket : si c'était le dernier (local + cross-instance) d'un
  // joueur, on le sort de la file et on arme la grâce s'il est en partie.
  async function handleSocketGone(userId, ws) {
    removeSocket(userId, ws);
    if (stopped) return; // arrêt en cours : ne rien armer ni toucher à Redis
    if (sockets.has(userId)) return; // un autre onglet local reste
    await presenceStore.removeOnline(userId);
    if (await presenceStore.isOnline(userId)) return; // connecté sur une autre instance
    await matchmakingStore.leave(userId);
    await dropChallengesOf(userId);
    const sid = await sessionStore.sessionIdForUser(userId);
    if (sid) {
      const s = await sessionStore.getSession(sid);
      if (s && !s.finished) {
        const deadline = Date.now() + graceMs;
        await presenceStore.setGrace(userId, deadline);
        const opp = opponentOf(s, userId);
        if (opp) notify(opp.userId, { t: 'opponentDisconnected', deadline, graceMs });
      }
    }
    schedulePresence();
  }

  // ── Heartbeat ──
  let heartbeat = null;
  if (heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        ws.ping();
      }
      // Rafraîchit les marqueurs online des joueurs connectés ici (#30) : sinon
      // ils expireraient (TTL), et les marqueurs d'une instance morte expirent
      // d'eux-mêmes — débloquant la détection de déconnexion.
      presenceStore.refreshOnline([...sockets.keys()]).catch(() => {});
    }, heartbeatMs);
    if (heartbeat.unref) heartbeat.unref();
  }

  function stop() {
    stopped = true;
    clearInterval(tickTimer);
    clearInterval(sweepTimer);
    if (heartbeat) clearInterval(heartbeat);
    accountRemoval.setHandler(null);
    if (presenceTimer) { clearTimeout(presenceTimer); presenceTimer = null; }
    offBus();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  }

  return { wss, sockets, stop };
}

module.exports = { attachWebSocketServer };
