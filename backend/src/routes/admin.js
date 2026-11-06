'use strict';

// Tableau de bord administrateur (#311). Jours calculés à l'heure de Paris.

const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../middleware/admin');
const presenceStore = require('../realtime/presenceStore');
const geo = require('../services/geo');
const { IP_RETENTION_DAYS } = require('../services/visits');
const config = require('../config');

// Démarrage du processus : date du dernier déploiement du serveur.
const STARTED_AT = new Date().toISOString();

const router = express.Router();
router.use(requireAdmin);

const TZ = 'Europe/Paris';
const DAY = (col) => `(${col} AT TIME ZONE '${TZ}')::date`;

// Jours de la période, du plus ancien à aujourd'hui : $1 = nombre de jours.
const DAYS_SERIES = `
  SELECT generate_series(
    (NOW() AT TIME ZONE '${TZ}')::date - ($1::int - 1),
    (NOW() AT TIME ZONE '${TZ}')::date,
    INTERVAL '1 day'
  )::date AS day`;

const SINCE = `(((NOW() AT TIME ZONE '${TZ}')::date - ($1::int - 1))::timestamp AT TIME ZONE '${TZ}')`;

function parseDays(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 30;
  return Math.min(365, Math.max(7, n));
}

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

async function players() {
  const { rows } = await query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE email_verified)::int AS verified,
           (SELECT COUNT(DISTINCT gp.user_id)::int FROM game_players gp JOIN games g ON g.id = gp.game_id
             WHERE gp.user_id IS NOT NULL AND g.ended_at > NOW() - INTERVAL '1 day') AS active1d,
           (SELECT COUNT(DISTINCT gp.user_id)::int FROM game_players gp JOIN games g ON g.id = gp.game_id
             WHERE gp.user_id IS NOT NULL AND g.ended_at > NOW() - INTERVAL '7 days') AS active7d,
           (SELECT COUNT(DISTINCT gp.user_id)::int FROM game_players gp JOIN games g ON g.id = gp.game_id
             WHERE gp.user_id IS NOT NULL AND g.ended_at > NOW() - INTERVAL '30 days') AS active30d
    FROM users`);
  return rows[0];
}

// Par jour : inscriptions (et total cumulé), joueurs actifs, parties par mode,
// minutes de jeu. Une partie sans durée enregistrée (avant #311) compte 0 minute.
async function daily(days) {
  const { rows } = await query(`
    WITH d AS (${DAYS_SERIES}),
    s AS (SELECT ${DAY('created_at')} AS day, COUNT(*)::int AS n FROM users
          WHERE created_at >= ${SINCE} GROUP BY 1),
    g AS (SELECT ${DAY('g.ended_at')} AS day,
                 COUNT(*) FILTER (WHERE g.mode = 'online')::int AS online,
                 COUNT(*) FILTER (WHERE g.mode = 'ai')::int AS ai,
                 COUNT(*) FILTER (WHERE g.mode NOT IN ('online', 'ai'))::int AS other,
                 COALESCE(SUM(EXTRACT(EPOCH FROM (g.ended_at - g.created_at))) / 60, 0)::float AS minutes
          FROM games g WHERE g.ended_at >= ${SINCE} GROUP BY 1),
    a AS (SELECT ${DAY('g.ended_at')} AS day, COUNT(DISTINCT gp.user_id)::int AS n
          FROM games g JOIN game_players gp ON gp.game_id = g.id
          WHERE g.ended_at >= ${SINCE} AND gp.user_id IS NOT NULL GROUP BY 1),
    before AS (SELECT COUNT(*)::int AS n FROM users WHERE created_at < ${SINCE})
    SELECT d.day,
           COALESCE(s.n, 0) AS signups,
           (SELECT n FROM before) + SUM(COALESCE(s.n, 0)) OVER (ORDER BY d.day)::int AS total_users,
           COALESCE(a.n, 0) AS active_players,
           COALESCE(g.online, 0) AS games_online,
           COALESCE(g.ai, 0) AS games_ai,
           COALESCE(g.other, 0) AS games_other,
           COALESCE(g.minutes, 0) AS play_minutes
    FROM d LEFT JOIN s USING (day) LEFT JOIN g USING (day) LEFT JOIN a USING (day)
    ORDER BY d.day`, [days]);
  return rows.map(r => ({
    day: iso(r.day),
    signups: r.signups,
    totalUsers: Number(r.total_users),
    activePlayers: r.active_players,
    games: { online: r.games_online, ai: r.games_ai, other: r.games_other },
    playMinutes: Math.round(Number(r.play_minutes)),
  }));
}

async function playTime(days) {
  const { rows } = await query(`
    SELECT COUNT(*)::int AS games,
           COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - created_at))) / 60, 0)::float AS minutes
    FROM games
    WHERE ended_at >= ${SINCE} AND ended_at > created_at`, [days]);
  const { games, minutes } = rows[0];
  return {
    timedGames: games,
    totalMinutes: Math.round(minutes),
    averageMinutes: games ? Math.round((minutes / games) * 10) / 10 : null,
  };
}

async function visitStats(days) {
  const byDay = await query(`
    WITH d AS (${DAYS_SERIES}),
    v AS (SELECT ${DAY('created_at')} AS day, COUNT(*)::int AS visits,
                 COUNT(DISTINCT visitor_key)::int AS visitors
          FROM visits WHERE created_at >= ${SINCE} GROUP BY 1)
    SELECT d.day, COALESCE(v.visits, 0) AS visits, COALESCE(v.visitors, 0) AS visitors
    FROM d LEFT JOIN v USING (day) ORDER BY d.day`, [days]);

  const top = async (expr, limit = 10) => (await query(`
    SELECT ${expr} AS label, COUNT(*)::int AS visits, COUNT(DISTINCT visitor_key)::int AS visitors
    FROM visits WHERE created_at >= ${SINCE}
    GROUP BY 1 ORDER BY visits DESC, label LIMIT ${limit}`, [days])).rows;

  const totals = await query(`
    SELECT COUNT(*)::int AS visits,
           COUNT(DISTINCT (visitor_key, ${DAY('created_at')}))::int AS visitor_days
    FROM visits WHERE created_at >= ${SINCE}`, [days]);

  return {
    totals: totals.rows[0],
    byDay: byDay.rows.map(r => ({ day: iso(r.day), visits: r.visits, visitors: r.visitors })),
    countries: await top(`COALESCE(country, '??')`),
    cities: await top(`COALESCE(city || ', ' || country, 'Inconnue')`),
    pages: await top('path'),
    referrers: await top(`COALESCE(referrer_host, '(direct)')`),
    devices: await top('device', 3),
  };
}

async function recentVisits() {
  const { rows } = await query(`
    SELECT v.created_at, v.path, v.device, host(v.ip) AS ip, v.country, v.region, v.city,
           v.referrer_host, u.username
    FROM visits v LEFT JOIN users u ON u.id = v.user_id
    ORDER BY v.created_at DESC LIMIT 100`);
  return rows.map(r => ({
    at: r.created_at,
    path: r.path,
    device: r.device,
    ip: r.ip,
    country: r.country,
    region: r.region,
    city: r.city,
    referrer: r.referrer_host,
    username: r.username,
  }));
}

// ─── GET /api/admin/dashboard?days=30 ─────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  const days = parseDays(req.query.days);
  try {
    const [live, playerCounts, perDay, time, visitData, recent, geoSource] = await Promise.all([
      presenceStore.counts().catch(() => null),
      players(),
      daily(days),
      playTime(days),
      visitStats(days),
      recentVisits(),
      geo.sourceName().catch(() => null),
    ]);
    res.json({
      days,
      generatedAt: new Date().toISOString(),
      ipRetentionDays: IP_RETENTION_DAYS,
      geoSource,
      server: { ...config.release, startedAt: STARTED_AT },
      live,
      players: playerCounts,
      daily: perDay,
      playTime: time,
      visits: { ...visitData, recent },
    });
  } catch (err) {
    req.log.error({ err }, 'GET /admin/dashboard');
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

module.exports = router;
