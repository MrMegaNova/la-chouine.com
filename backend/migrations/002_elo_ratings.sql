-- Migration 002 : classement Elo par joueur et par variante.
-- Chaque joueur démarre à 1500 (comme aux échecs), avec une note distincte
-- pour la variante Classique et pour la variante Mondoubleau.

ALTER TABLE users
    ADD COLUMN rating_classic     INT NOT NULL DEFAULT 1500,
    ADD COLUMN rating_mondoubleau INT NOT NULL DEFAULT 1500,
    ADD CONSTRAINT rating_classic_positive     CHECK (rating_classic     >= 0),
    ADD CONSTRAINT rating_mondoubleau_positive CHECK (rating_mondoubleau >= 0);

-- Trace de la variation d'Elo par partie classée (renseigné uniquement pour les
-- parties online classées ; NULL sinon). Permet d'afficher le delta côté profil.
ALTER TABLE game_players
    ADD COLUMN rating_before SMALLINT,
    ADD COLUMN rating_after  SMALLINT;
