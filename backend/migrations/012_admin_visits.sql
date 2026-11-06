-- Migration 012 : tableau de bord administrateur (#311).
--
-- `users.is_admin` : accès à /admin. Attribué à la main (voir la PR).
--
-- `visits` : une ligne par page vue. L'IP complète n'est gardée que 30 jours
-- (purge périodique côté backend : `ip` passe à NULL). La localisation et
-- `visitor_key` restent pour les statistiques : `visitor_key` est une empreinte
-- de l'IP et du navigateur, salée par un secret et par la date, donc non
-- réversible et différente chaque jour.

ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE visits (
    id            BIGSERIAL    PRIMARY KEY,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    path          VARCHAR(200) NOT NULL,
    referrer_host VARCHAR(100),
    device        VARCHAR(10)  NOT NULL CHECK (device IN ('mobile', 'tablet', 'desktop')),
    ip            INET,
    country       VARCHAR(2),
    region        VARCHAR(100),
    city          VARCHAR(100),
    visitor_key   CHAR(32)     NOT NULL,
    user_id       UUID         REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_visits_created_at ON visits (created_at);
CREATE INDEX idx_visits_ip_retention ON visits (created_at) WHERE ip IS NOT NULL;
