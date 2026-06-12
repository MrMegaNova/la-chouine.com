-- Révocation des JWT (#117) : chaque token embarque la version courante du
-- compte ; incrémenter la version invalide tous les tokens déjà émis
-- (changement ou réinitialisation du mot de passe).
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
