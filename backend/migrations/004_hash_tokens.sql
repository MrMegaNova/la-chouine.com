-- Tokens de vérification/réinitialisation hashés (#122) : on ne stocke plus le
-- token en clair mais son SHA-256 (64 caractères hex, même largeur CHAR(64)).
-- Les tokens en cours sont éphémères (≤ 24 h / 1 h) : on les invalide, les
-- utilisateurs concernés en redemanderont un (« mot de passe oublié »).
UPDATE users
SET verify_token = NULL, verify_expires = NULL
WHERE verify_token IS NOT NULL;

UPDATE users
SET reset_token = NULL, reset_expires = NULL
WHERE reset_token IS NOT NULL;
