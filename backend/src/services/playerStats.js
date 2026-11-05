'use strict';

// Statistiques d'un joueur (#279). Deux origines, jamais additionnées :
//  • en ligne (`mode = 'online'`) : résultat arbitré par le serveur (GameSession
//    → matchRecorder), seule base de ce qui se compare entre joueurs ;
//  • local (ai/local/friend) : résultat déclaré par le navigateur via
//    POST /api/games, invérifiable, affiché à titre indicatif.
//
// Fragment à placer après `FROM users u` (une seule ligne par joueur). On compte
// les PARTIES et non les sièges : d'anciennes parties locales peuvent asseoir le
// même joueur plusieurs fois, et ces lignes sont conservées telles quelles.
const STATS_JOIN = `
  LEFT JOIN LATERAL (
    SELECT
      COUNT(DISTINCT gp.game_id) FILTER (WHERE g.mode = 'online' AND gp.won = TRUE)   AS online_wins,
      COUNT(DISTINCT gp.game_id) FILTER (WHERE g.mode = 'online' AND gp.won = FALSE)  AS online_losses,
      COUNT(DISTINCT gp.game_id) FILTER (WHERE g.mode = 'online')                     AS online_plays,
      COUNT(DISTINCT gp.game_id) FILTER (WHERE g.mode <> 'online' AND gp.won = TRUE)  AS local_wins,
      COUNT(DISTINCT gp.game_id) FILTER (WHERE g.mode <> 'online' AND gp.won = FALSE) AS local_losses,
      COUNT(DISTINCT gp.game_id) FILTER (WHERE g.mode <> 'online')                    AS local_plays
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE gp.user_id = u.id
  ) stats ON TRUE`;

const STATS_COLUMNS = `stats.online_wins, stats.online_losses, stats.online_plays,
              stats.local_wins, stats.local_losses, stats.local_plays`;

// Forme exposée par l'API : `wins`/`losses`/`plays` sont les résultats établis
// par le serveur ; les résultats déclarés restent à part, dans `local`.
function formatStats(row) {
  return {
    wins: Number(row.online_wins),
    losses: Number(row.online_losses),
    plays: Number(row.online_plays),
    local: {
      wins: Number(row.local_wins),
      losses: Number(row.local_losses),
      plays: Number(row.local_plays),
    },
  };
}

module.exports = { STATS_JOIN, STATS_COLUMNS, formatStats };
