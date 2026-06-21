'use strict';

// Badges / récompenses (#217). Le catalogue est dérivé des STATS CUMULÉES du
// joueur (parties, victoires, Elo) : l'évaluation est donc idempotente et
// auto-réparable (la rejouer ne crée pas de doublon, et un badge manquant peut
// être rattrapé). Attribution côté serveur uniquement (jamais le client, #116).
//
// `test(stats)` reçoit : { plays, wins, losses, ratingMax } où ratingMax est le
// meilleur Elo des deux variantes. Le frontend duplique ce catalogue (labels)
// dans `frontend/src/game/achievements.ts` — garder les CODES synchronisés.

const CATALOG = [
  { code: 'premiere-partie',   label: 'Première partie',  description: 'Jouer votre toute première partie.',        icon: '🎴', test: s => s.plays >= 1 },
  { code: 'premiere-victoire', label: 'Première victoire', description: 'Remporter votre première partie.',          icon: '🥇', test: s => s.wins >= 1 },
  { code: 'habitue',           label: 'Habitué',           description: 'Jouer 10 parties.',                          icon: '🃏', test: s => s.plays >= 10 },
  { code: 'pilier',            label: 'Pilier',            description: 'Jouer 50 parties.',                          icon: '🛡️', test: s => s.plays >= 50 },
  { code: 'veteran',           label: 'Vétéran',           description: 'Jouer 100 parties.',                         icon: '🏛️', test: s => s.plays >= 100 },
  { code: 'legende',           label: 'Légende',           description: 'Jouer 500 parties.',                         icon: '👑', test: s => s.plays >= 500 },
  { code: 'gagnant',           label: 'Gagnant',           description: 'Remporter 10 parties.',                      icon: '🏆', test: s => s.wins >= 10 },
  { code: 'champion',          label: 'Champion',          description: 'Remporter 100 parties.',                     icon: '🌟', test: s => s.wins >= 100 },
  { code: 'classe-1600',       label: 'Classé 1600',       description: 'Atteindre 1600 d’Elo dans une variante.',    icon: '📈', test: s => s.ratingMax >= 1600 },
  { code: 'expert-1800',       label: 'Expert 1800',       description: 'Atteindre 1800 d’Elo dans une variante.',    icon: '⚔️', test: s => s.ratingMax >= 1800 },
  { code: 'maitre-2000',       label: 'Maître 2000',       description: 'Atteindre 2000 d’Elo dans une variante.',    icon: '💎', test: s => s.ratingMax >= 2000 },
];

const CODES = new Set(CATALOG.map(a => a.code));

/**
 * Évalue et débloque les badges d'un joueur à partir de ses stats cumulées.
 * À appeler DANS la transaction qui vient d'enregistrer une partie. Idempotent
 * (ON CONFLICT DO NOTHING). Renvoie la liste des codes nouvellement débloqués.
 * @param {import('pg').PoolClient} client
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
async function evaluateAchievements(client, userId) {
  if (!userId) return [];
  const { rows } = await client.query(
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
       FROM game_players gp
       WHERE gp.user_id = $1
       GROUP BY gp.user_id
     ) s ON s.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  if (!rows.length) return [];
  const r = rows[0];
  const stats = {
    plays: Number(r.plays),
    wins: Number(r.wins),
    losses: Number(r.losses),
    ratingMax: Math.max(Number(r.rating_classic), Number(r.rating_mondoubleau)),
  };

  const earned = CATALOG.filter(a => a.test(stats)).map(a => a.code);
  if (!earned.length) return [];

  const values = earned.map((_, i) => `($1, $${i + 2})`).join(', ');
  const res = await client.query(
    `INSERT INTO user_achievements (user_id, code)
     VALUES ${values}
     ON CONFLICT (user_id, code) DO NOTHING
     RETURNING code`,
    [userId, ...earned]
  );
  return res.rows.map(row => row.code); // uniquement les NOUVEAUX (RETURNING)
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

module.exports = { CATALOG, CODES, evaluateAchievements, listAchievements };
