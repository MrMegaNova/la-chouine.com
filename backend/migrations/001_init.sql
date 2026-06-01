-- Migration 001 : schéma initial de la-chouine.com

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Utilisateurs ────────────────────────────────────────────────────────────

CREATE TABLE users (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    username         VARCHAR(30)  NOT NULL,
    email            VARCHAR(255) NOT NULL,
    password_hash    VARCHAR(72)  NOT NULL,
    email_verified   BOOLEAN      NOT NULL DEFAULT FALSE,
    verify_token     CHAR(64),
    verify_expires   TIMESTAMPTZ,
    reset_token      CHAR(64),
    reset_expires    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT users_username_unique UNIQUE (username),
    CONSTRAINT username_length  CHECK (LENGTH(username) BETWEEN 2 AND 30),
    CONSTRAINT username_charset CHECK (username ~ '^[A-Za-z0-9_\-]+$')
);

CREATE UNIQUE INDEX idx_users_email  ON users (LOWER(email));
CREATE INDEX idx_users_verify_token ON users (verify_token) WHERE verify_token IS NOT NULL;
CREATE INDEX idx_users_reset_token  ON users (reset_token)  WHERE reset_token  IS NOT NULL;

-- ─── Amis ─────────────────────────────────────────────────────────────────────

CREATE TABLE friendships (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT no_self_friend CHECK (requester_id <> addressee_id),
    CONSTRAINT unique_friendship UNIQUE (requester_id, addressee_id)
);

-- Index bidirectionnel pour retrouver rapidement les amis d'un utilisateur
CREATE INDEX idx_friendships_requester ON friendships (requester_id);
CREATE INDEX idx_friendships_addressee ON friendships (addressee_id);
CREATE INDEX idx_friendships_pair ON friendships (
    LEAST(requester_id::TEXT, addressee_id::TEXT),
    GREATEST(requester_id::TEXT, addressee_id::TEXT)
);

-- ─── Parties ──────────────────────────────────────────────────────────────────

CREATE TABLE games (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    mode         VARCHAR(20) NOT NULL CHECK (mode IN ('ai', 'local', 'online', 'friend')),
    variant      VARCHAR(20) NOT NULL DEFAULT 'classic'
                 CHECK (variant IN ('classic', 'mondoubleau')),
    player_count SMALLINT    NOT NULL DEFAULT 2 CHECK (player_count IN (2, 3, 4)),
    target_score SMALLINT    NOT NULL DEFAULT 3 CHECK (target_score IN (3, 5)),
    difficulty   VARCHAR(10)          CHECK (difficulty IN ('easy', 'normal', 'hard')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at     TIMESTAMPTZ
);

CREATE TABLE game_players (
    id         UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id    UUID     NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id    UUID              REFERENCES users(id) ON DELETE SET NULL,
    guest_name VARCHAR(30),
    seat       SMALLINT NOT NULL CHECK (seat BETWEEN 0 AND 3),
    score      SMALLINT,
    won        BOOLEAN,

    CONSTRAINT game_seat_unique UNIQUE (game_id, seat),
    CONSTRAINT must_have_identity CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL)
);

CREATE INDEX idx_game_players_user ON game_players (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_game_players_game ON game_players (game_id);

-- ─── Triggers updated_at ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_friendships_updated_at
    BEFORE UPDATE ON friendships
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
