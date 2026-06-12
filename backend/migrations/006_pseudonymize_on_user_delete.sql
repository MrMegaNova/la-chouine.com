-- Suppression d'un utilisateur ayant des parties (#134).
--
-- game_players.user_id est REFERENCES users(id) ON DELETE SET NULL, et la
-- contrainte must_have_identity exige (user_id IS NOT NULL OR guest_name IS NOT
-- NULL). Supprimer un utilisateur passe donc ses sièges à user_id = NULL ; si
-- guest_name était NULL (cas d'un vrai joueur), le CHECK échoue (code 23514) et
-- la suppression est impossible — bloquant pour un futur « supprimer mon
-- compte » (RGPD) ou une purge d'admin.
--
-- Correctif : un trigger BEFORE DELETE pseudonymise les sièges du joueur en y
-- recopiant son pseudo dans guest_name. La partie reste cohérente (l'adversaire
-- voit l'ancien pseudo en invité) et le SET NULL ne viole plus le CHECK.

CREATE OR REPLACE FUNCTION pseudonymize_user_games()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE game_players
  SET guest_name = LEFT(OLD.username, 30)
  WHERE user_id = OLD.id AND guest_name IS NULL;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pseudonymize_user_games
  BEFORE DELETE ON users
  FOR EACH ROW
  EXECUTE FUNCTION pseudonymize_user_games();
