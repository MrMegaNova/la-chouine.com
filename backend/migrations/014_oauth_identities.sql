-- Migration 014 : connexion avec Google, Facebook ou Apple.
--
-- `user_identities` : un compte du fournisseur (`provider` + `subject`, son
-- identifiant stable) rattaché à un joueur. Un joueur peut en avoir plusieurs.
--
-- `users.password_hash` devient facultatif : un compte créé par un fournisseur
-- n'a pas de mot de passe tant que le joueur n'en définit pas un (« Mot de passe
-- oublié »). La connexion par pseudo et mot de passe échoue alors toujours.

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE user_identities (
    provider    VARCHAR(20)  NOT NULL CHECK (provider IN ('google', 'facebook', 'apple')),
    subject     VARCHAR(255) NOT NULL,
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email       VARCHAR(255),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, subject)
);

CREATE INDEX idx_user_identities_user ON user_identities (user_id);
