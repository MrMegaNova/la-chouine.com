-- Migration 009 : provenance des badges (#279).
--
-- Une partie locale (ai/local/friend) est déclarée par le navigateur : le serveur
-- ne peut établir ni son résultat, ni même qu'elle a été jouée. `verified` indique
-- si les parties EN LIGNE, arbitrées par le serveur, suffisent à justifier le
-- badge. Seuls les badges vérifiés sont publics.
--
-- Aucune ligne n'est supprimée et `unlocked_at` ne change pas. Les badges d'Elo et
-- les faits de jeu sont établis par le serveur : ils gardent la valeur par défaut.
-- Les conditions ci-dessous reprennent celles de `services/achievements.js`.

ALTER TABLE user_achievements ADD COLUMN verified BOOLEAN NOT NULL DEFAULT TRUE;

-- Jours fériés français : même calcul que `holidaySet` (Pâques : Meeus/Jones/Butcher).
CREATE FUNCTION pg_temp.is_french_holiday(day DATE) RETURNS BOOLEAN AS $$
DECLARE
  y INT := EXTRACT(YEAR FROM day);
  a INT := y % 19;
  b INT := y / 100;
  c INT := y % 100;
  d INT := b / 4;
  e INT := b % 4;
  f INT := (b + 8) / 25;
  g INT := (b - f + 1) / 3;
  h INT := (19 * a + b - d - g + 15) % 30;
  i INT := c / 4;
  k INT := c % 4;
  l INT := (32 + 2 * e + 2 * i - h - k) % 7;
  m INT := (a + 11 * h + 22 * l) / 451;
  easter DATE := make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
BEGIN
  RETURN to_char(day, 'MM-DD') IN ('01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25')
      OR day IN (easter + 1, easter + 39, easter + 50);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

WITH online_seats AS (
  SELECT gp.user_id, gp.game_id, gp.won, g.variant,
         (g.ended_at AT TIME ZONE 'Europe/Paris')::date AS day
  FROM game_players gp
  JOIN games g ON g.id = gp.game_id
  WHERE g.mode = 'online' AND gp.user_id IS NOT NULL
),
games_facts AS (
  SELECT user_id,
         COUNT(DISTINCT game_id) AS plays,
         COUNT(DISTINCT game_id) FILTER (WHERE won = TRUE) AS wins,
         COUNT(DISTINCT game_id) FILTER (WHERE won = TRUE AND variant = 'classic') AS wins_classic,
         COUNT(DISTINCT game_id) FILTER (WHERE won = TRUE AND variant = 'mondoubleau') AS wins_mondoubleau
  FROM online_seats
  GROUP BY user_id
),
days AS (
  SELECT DISTINCT user_id, day FROM online_seats WHERE day IS NOT NULL
),
days_facts AS (
  SELECT user_id,
         BOOL_OR(EXTRACT(ISODOW FROM day) IN (6, 7)) AS weekend,
         BOOL_OR(pg_temp.is_french_holiday(day)) AS holiday
  FROM days
  GROUP BY user_id
),
-- Jours consécutifs : jour moins son rang = valeur constante sur une série.
streaks AS (
  SELECT user_id, MAX(len) AS max_streak
  FROM (
    SELECT user_id, COUNT(*) AS len
    FROM (
      SELECT user_id, day - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY day))::int AS series
      FROM days
    ) numbered
    GROUP BY user_id, series
  ) series_lengths
  GROUP BY user_id
)
UPDATE user_achievements a
SET verified = CASE a.code
  WHEN 'premiere-partie'   THEN COALESCE(gf.plays, 0) >= 1
  WHEN 'habitue'           THEN COALESCE(gf.plays, 0) >= 10
  WHEN 'pilier'            THEN COALESCE(gf.plays, 0) >= 50
  WHEN 'veteran'           THEN COALESCE(gf.plays, 0) >= 100
  WHEN 'legende'           THEN COALESCE(gf.plays, 0) >= 500
  WHEN 'premiere-victoire' THEN COALESCE(gf.wins, 0) >= 1
  WHEN 'gagnant'           THEN COALESCE(gf.wins, 0) >= 10
  WHEN 'champion'          THEN COALESCE(gf.wins, 0) >= 100
  WHEN 'ambidextre'        THEN COALESCE(gf.wins_classic, 0) >= 1 AND COALESCE(gf.wins_mondoubleau, 0) >= 1
  WHEN 'joueur-weekend'    THEN COALESCE(df.weekend, FALSE)
  WHEN 'jour-ferie'        THEN COALESCE(df.holiday, FALSE)
  WHEN 'assidu'            THEN COALESCE(s.max_streak, 0) >= 3
END
FROM user_achievements base
LEFT JOIN games_facts gf ON gf.user_id = base.user_id
LEFT JOIN days_facts df ON df.user_id = base.user_id
LEFT JOIN streaks s ON s.user_id = base.user_id
WHERE base.user_id = a.user_id AND base.code = a.code
  AND a.code IN ('premiere-partie', 'habitue', 'pilier', 'veteran', 'legende',
                 'premiere-victoire', 'gagnant', 'champion', 'ambidextre',
                 'joueur-weekend', 'jour-ferie', 'assidu');

DROP FUNCTION pg_temp.is_french_holiday(DATE);
