-- Suppression de compte (RGPD, #238) : le trigger de la migration 006 recopiait
-- le pseudo dans les parties, ce qui gardait un identifiant du joueur supprimé.
-- Ses sièges portent désormais un libellé commun, sans lien avec le compte.

CREATE OR REPLACE FUNCTION pseudonymize_user_games()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE game_players
  SET guest_name = 'Ancien joueur'
  WHERE user_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
