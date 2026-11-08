-- Migration 013 : suivi des campagnes (#290).
--
-- `source` : campagne d'où arrive le visiteur, lue dans le lien (`?src=affiche`).
-- Renseignée seulement sur la première page de la visite.

ALTER TABLE visits ADD COLUMN source VARCHAR(40);

CREATE INDEX idx_visits_source ON visits (created_at) WHERE source IS NOT NULL;
