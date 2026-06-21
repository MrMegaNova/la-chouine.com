-- Migration 007 : badges / récompenses (#217).
-- Parcours de progression gamifié. Les badges sont DÉRIVÉS des stats cumulées
-- du joueur (parties, victoires, Elo) et attribués côté serveur uniquement
-- (jamais par le client, cf. #116) — l'évaluation est idempotente.

CREATE TABLE user_achievements (
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT        NOT NULL,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Un même badge ne peut être débloqué qu'une fois par joueur (idempotence).
    PRIMARY KEY (user_id, code)
);

CREATE INDEX idx_user_achievements_user ON user_achievements (user_id);
