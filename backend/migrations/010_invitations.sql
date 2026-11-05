-- Migration 010 : lien d'invitation personnel (#295).
-- `invite_code` : code aléatoire du lien, créé à la première demande du joueur.
-- Il n'ouvre aucun accès au compte et doit pouvoir être réaffiché : il est donc
-- stocké en clair, contrairement aux tokens de vérification et de réinitialisation.
-- `invited_by` : conservé dès l'inscription, pris en compte à la vérification de
-- l'email. Passe à NULL si le compte qui a invité est supprimé.

ALTER TABLE users
    ADD COLUMN invite_code VARCHAR(32),
    ADD COLUMN invited_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD CONSTRAINT users_invite_code_unique UNIQUE (invite_code),
    ADD CONSTRAINT users_invite_code_format CHECK (invite_code ~ '^[0-9a-f]{32}$'),
    ADD CONSTRAINT users_no_self_invite CHECK (invited_by <> id);

CREATE INDEX idx_users_invited_by ON users (invited_by) WHERE invited_by IS NOT NULL;
