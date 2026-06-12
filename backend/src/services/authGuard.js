'use strict';

// ─── Garde-fous d'authentification (#86) ─────────────────────────────────────
// Protections en mémoire, complémentaires du rate-limiting global :
//  - brute-force du login : compteur d'échecs PAR COUPLE IP+pseudo (le
//    limiteur global à 20 req/15 min laisse passer 20 essais ciblés) ;
//  - inscriptions en masse : plafond d'inscriptions réussies par IP / 24 h.
// Mémoire locale au processus : suffisant pour un serveur unique — à migrer
// vers Redis avec le reste de l'état partagé (#31). Les réponses des routes
// restent génériques : rien ne fuit sur l'existence d'un compte.

const DEFAULTS = {
  loginMaxFailures: 5,            // échecs avant blocage
  loginWindowMs: 15 * 60_000,     // fenêtre de comptage des échecs
  loginBlockMs: 15 * 60_000,      // durée du blocage
  registerMaxPerWindow: 5,        // inscriptions réussies par IP…
  registerWindowMs: 24 * 3_600_000, // …par 24 h
  maxEntries: 50_000,             // borne mémoire (purge paresseuse)
};

function createAuthGuard(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const loginFailures = new Map(); // "ip|pseudo" → { count, firstAt, blockedUntil }
  const registrations = new Map(); // ip → [timestamps des inscriptions réussies]

  const loginKey = (ip, username) => `${ip}|${String(username).toLowerCase()}`;

  // Purge paresseuse : retire les entrées expirées quand la table grossit,
  // pour borner la mémoire sans timer dédié.
  function pruneIfNeeded(now) {
    if (loginFailures.size > cfg.maxEntries) {
      for (const [k, e] of loginFailures) {
        if (e.blockedUntil <= now && now - e.firstAt > cfg.loginWindowMs) loginFailures.delete(k);
      }
    }
    if (registrations.size > cfg.maxEntries) {
      for (const [ip, times] of registrations) {
        if (times.every(t => now - t > cfg.registerWindowMs)) registrations.delete(ip);
      }
    }
  }

  return {
    /** Le couple IP+pseudo a-t-il le droit de tenter une connexion ? */
    loginAllowed(ip, username, now = Date.now()) {
      const e = loginFailures.get(loginKey(ip, username));
      if (!e || e.blockedUntil <= now) return { allowed: true };
      return { allowed: false, retryAfterMs: e.blockedUntil - now };
    },

    /** À appeler après un échec d'identification (mauvais pseudo ou mot de passe). */
    loginFailed(ip, username, now = Date.now()) {
      pruneIfNeeded(now);
      const key = loginKey(ip, username);
      const e = loginFailures.get(key);
      if (!e || now - e.firstAt > cfg.loginWindowMs) {
        loginFailures.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
        return;
      }
      e.count += 1;
      if (e.count >= cfg.loginMaxFailures) {
        e.blockedUntil = now + cfg.loginBlockMs;
        e.firstAt = now; // le blocage repart proprement si on insiste après
        e.count = 0;
      }
    },

    /** À appeler après une connexion réussie : efface l'ardoise du couple. */
    loginSucceeded(ip, username) {
      loginFailures.delete(loginKey(ip, username));
    },

    /** L'IP a-t-elle encore droit à une inscription ? */
    registerAllowed(ip, now = Date.now()) {
      const times = registrations.get(ip) ?? [];
      return times.filter(t => now - t <= cfg.registerWindowMs).length < cfg.registerMaxPerWindow;
    },

    /** À appeler après une inscription réussie (compte réellement créé). */
    registerRecorded(ip, now = Date.now()) {
      pruneIfNeeded(now);
      const times = (registrations.get(ip) ?? []).filter(t => now - t <= cfg.registerWindowMs);
      times.push(now);
      registrations.set(ip, times);
    },
  };
}

module.exports = { createAuthGuard, authGuard: createAuthGuard() };
