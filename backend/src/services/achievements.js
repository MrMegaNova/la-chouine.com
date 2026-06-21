'use strict';

// Badges / récompenses (#217). Deux familles :
//  • « dérivés » : recalculés depuis les STATS CUMULÉES (parties, victoires, Elo,
//    variantes gagnées, dates de jeu) → idempotents et auto-réparables, via
//    `evaluateAchievements`. `test(stats)` décide du déblocage.
//  • « événementiels » (faits de jeu) : débloqués au moment d'un fait précis
//    arbitré par le serveur (PvP), via `awardFact`. Pas de `test`.
// Attribution côté serveur uniquement (jamais le client, #116).
//
// Le frontend duplique ce catalogue (labels/icônes) dans
// `frontend/src/game/achievements.ts` — garder les CODES synchronisés.

const CATALOG = [
  // ── Assiduité (nombre de parties) ──
  { code: 'premiere-partie',   label: 'Première partie',   description: 'Jouer votre toute première partie.',        icon: '🎴', test: s => s.plays >= 1 },
  { code: 'habitue',           label: 'Habitué',           description: 'Jouer 10 parties.',                          icon: '🃏', test: s => s.plays >= 10 },
  { code: 'pilier',            label: 'Pilier',            description: 'Jouer 50 parties.',                          icon: '🛡️', test: s => s.plays >= 50 },
  { code: 'veteran',           label: 'Vétéran',           description: 'Jouer 100 parties.',                         icon: '🏛️', test: s => s.plays >= 100 },
  { code: 'legende',           label: 'Légende',           description: 'Jouer 500 parties.',                         icon: '👑', test: s => s.plays >= 500 },

  // ── Performance (victoires) ──
  { code: 'premiere-victoire', label: 'Première victoire', description: 'Remporter votre première partie.',           icon: '🥇', test: s => s.wins >= 1 },
  { code: 'gagnant',           label: 'Gagnant',           description: 'Remporter 10 parties.',                      icon: '🏆', test: s => s.wins >= 10 },
  { code: 'champion',          label: 'Champion',          description: 'Remporter 100 parties.',                     icon: '🌟', test: s => s.wins >= 100 },

  // ── Classement (Elo) ──
  { code: 'classe-1600',       label: 'Classé 1600',       description: 'Atteindre 1600 d’Elo dans une variante.',    icon: '📈', test: s => s.ratingMax >= 1600 },
  { code: 'expert-1800',       label: 'Expert 1800',       description: 'Atteindre 1800 d’Elo dans une variante.',    icon: '⚔️', test: s => s.ratingMax >= 1800 },
  { code: 'maitre-2000',       label: 'Maître 2000',       description: 'Atteindre 2000 d’Elo dans une variante.',    icon: '💎', test: s => s.ratingMax >= 2000 },

  // ── Variantes ──
  { code: 'ambidextre',        label: 'Ambidextre',        description: 'Gagner au moins une partie en Classique ET en Mondoubleau.', icon: '🔄', test: s => s.winsClassic >= 1 && s.winsMondoubleau >= 1 },

  // ── Jours de jeu ──
  { code: 'joueur-weekend',    label: 'Joueur du week-end', description: 'Jouer une partie un samedi ou un dimanche.', icon: '🌅', test: s => s.playedWeekend },
  { code: 'jour-ferie',        label: 'Jour férié',         description: 'Jouer une partie un jour férié.',            icon: '🎉', test: s => s.playedHoliday },
  { code: 'assidu',            label: 'Assidu',             description: 'Jouer 3 jours consécutifs.',                 icon: '🔥', test: s => s.maxConsecutiveDays >= 3 },

  // ── Faits de jeu (événementiels, PvP arbitré par le serveur) ──
  { code: 'partie-blanche',    label: 'Partie blanche',    description: 'Gagner une partie classée sans que l’adversaire ne remporte une manche.', icon: '⬜', event: true },
  { code: 'chouine-faite',     label: 'Chouine !',         description: 'Réaliser une chouine en partie classée.',    icon: '🦉', event: true },
];

const CODES = new Set(CATALOG.map(a => a.code));
const EVENT_CODES = new Set(CATALOG.filter(a => a.event).map(a => a.code));

// ─── Jours fériés français ────────────────────────────────────────────────────
// Fériés fixes + fériés mobiles dérivés de Pâques (lundi de Pâques, Ascension,
// lundi de Pentecôte). Calcul de Pâques : algorithme de Meeus/Jones/Butcher.
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function holidaySet(year) {
  const fixed = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'];
  const set = new Set(fixed.map(md => `${year}-${md}`));
  const iso = (d) => d.toISOString().slice(0, 10);
  const easter = easterSunday(year);
  const plus = (n) => { const d = new Date(easter); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  set.add(plus(1));  // lundi de Pâques
  set.add(plus(39)); // Ascension
  set.add(plus(50)); // lundi de Pentecôte
  return set;
}

// `dates` : tableau de chaînes 'YYYY-MM-DD' (heure de Paris), triées croissant.
function dayFacts(dates) {
  let playedWeekend = false;
  let playedHoliday = false;
  let maxConsecutiveDays = dates.length ? 1 : 0;
  const holidayCache = new Map();

  let run = dates.length ? 1 : 0;
  for (let idx = 0; idx < dates.length; idx++) {
    const ds = dates[idx];
    const d = new Date(`${ds}T12:00:00Z`);
    const dow = d.getUTCDay(); // 0 = dimanche, 6 = samedi
    if (dow === 0 || dow === 6) playedWeekend = true;

    const year = Number(ds.slice(0, 4));
    if (!holidayCache.has(year)) holidayCache.set(year, holidaySet(year));
    if (holidayCache.get(year).has(ds)) playedHoliday = true;

    if (idx > 0) {
      const prev = new Date(`${dates[idx - 1]}T12:00:00Z`);
      const diffDays = Math.round((d - prev) / 86400000);
      run = diffDays === 1 ? run + 1 : 1;
      if (run > maxConsecutiveDays) maxConsecutiveDays = run;
    }
  }
  return { playedWeekend, playedHoliday, maxConsecutiveDays };
}

/**
 * Évalue et débloque les badges DÉRIVÉS d'un joueur depuis ses stats cumulées.
 * À appeler DANS la transaction qui vient d'enregistrer une partie. Idempotent
 * (ON CONFLICT DO NOTHING). Renvoie la liste des codes nouvellement débloqués.
 */
async function evaluateAchievements(client, userId) {
  if (!userId) return [];

  const base = await client.query(
    `SELECT u.rating_classic, u.rating_mondoubleau,
            COALESCE(s.wins, 0)   AS wins,
            COALESCE(s.losses, 0) AS losses,
            COALESCE(s.plays, 0)  AS plays
     FROM users u
     LEFT JOIN (
       SELECT gp.user_id,
              COUNT(*) FILTER (WHERE gp.won = TRUE)  AS wins,
              COUNT(*) FILTER (WHERE gp.won = FALSE) AS losses,
              COUNT(*)                                AS plays
       FROM game_players gp WHERE gp.user_id = $1 GROUP BY gp.user_id
     ) s ON s.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  if (!base.rows.length) return [];
  const r = base.rows[0];

  // Victoires par variante (pour le badge « ambidextre »).
  const variants = await client.query(
    `SELECT g.variant, COUNT(*) AS wins
     FROM game_players gp JOIN games g ON g.id = gp.game_id
     WHERE gp.user_id = $1 AND gp.won = TRUE
     GROUP BY g.variant`,
    [userId]
  );
  const winsByVariant = new Map(variants.rows.map(v => [v.variant, Number(v.wins)]));

  // Dates de jeu distinctes (heure de Paris) pour les badges « jours ».
  const days = await client.query(
    `SELECT DISTINCT to_char((g.ended_at AT TIME ZONE 'Europe/Paris')::date, 'YYYY-MM-DD') AS d
     FROM game_players gp JOIN games g ON g.id = gp.game_id
     WHERE gp.user_id = $1 AND g.ended_at IS NOT NULL
     ORDER BY d`,
    [userId]
  );
  const facts = dayFacts(days.rows.map(row => row.d));

  const stats = {
    plays: Number(r.plays),
    wins: Number(r.wins),
    losses: Number(r.losses),
    ratingMax: Math.max(Number(r.rating_classic), Number(r.rating_mondoubleau)),
    winsClassic: winsByVariant.get('classic') || 0,
    winsMondoubleau: winsByVariant.get('mondoubleau') || 0,
    ...facts,
  };

  const earned = CATALOG.filter(a => a.test && a.test(stats)).map(a => a.code);
  return insertEarned(client, userId, earned);
}

/**
 * Débloque un badge ÉVÉNEMENTIEL (fait de jeu PvP) précis. Idempotent.
 * Renvoie [code] s'il est nouveau, [] sinon (ou si le code est inconnu/non-event).
 */
async function awardFact(client, userId, code) {
  if (!userId || !EVENT_CODES.has(code)) return [];
  return insertEarned(client, userId, [code]);
}

async function insertEarned(client, userId, codes) {
  if (!codes.length) return [];
  const values = codes.map((_, i) => `($1, $${i + 2})`).join(', ');
  const res = await client.query(
    `INSERT INTO user_achievements (user_id, code)
     VALUES ${values}
     ON CONFLICT (user_id, code) DO NOTHING
     RETURNING code`,
    [userId, ...codes]
  );
  return res.rows.map(row => row.code);
}

/** Liste les badges débloqués d'un joueur (codes valides du catalogue). */
async function listAchievements(query, userId) {
  const { rows } = await query(
    `SELECT code, unlocked_at FROM user_achievements WHERE user_id = $1 ORDER BY unlocked_at`,
    [userId]
  );
  return rows
    .filter(r => CODES.has(r.code))
    .map(r => ({ code: r.code, unlockedAt: r.unlocked_at }));
}

module.exports = { CATALOG, CODES, evaluateAchievements, awardFact, listAchievements, easterSunday, dayFacts };
