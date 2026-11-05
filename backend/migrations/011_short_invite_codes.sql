-- Migration 011 : lien d'invitation court (#306).
-- Les codes passent de 32 caractères hexadécimaux à 6 caractères d'un alphabet
-- sans caractères ambigus (ni 0, 1, i, l, o), pour un lien facile à recopier.
-- Les codes déjà distribués sont conservés dans `invite_code_legacy` : les liens
-- partagés avant cette migration restent valides. Chaque joueur reçoit un code
-- court à sa prochaine demande.

ALTER TABLE users
    ADD COLUMN invite_code_legacy VARCHAR(32),
    ADD CONSTRAINT users_invite_code_legacy_unique UNIQUE (invite_code_legacy);

UPDATE users SET invite_code_legacy = invite_code, invite_code = NULL
WHERE invite_code IS NOT NULL;

ALTER TABLE users
    DROP CONSTRAINT users_invite_code_format,
    ADD CONSTRAINT users_invite_code_format CHECK (invite_code ~ '^[2-9a-hjkmnp-z]{6}$');
