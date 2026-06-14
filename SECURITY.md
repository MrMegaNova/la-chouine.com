# Sécurité — la-chouine.com

## Signaler une vulnérabilité

Merci de signaler tout problème de sécurité **en privé** (contact : contact@la-chouine.com),
sans ouvrir d'issue publique tant que le correctif n'est pas déployé.

## Invariants en place (ne pas régresser)

- **Révocation des JWT par `token_version`** : incrémentée à chaque changement/
  réinitialisation de mot de passe → invalide tous les JWT émis avant (#117).
- **Tokens de vérification/réinitialisation stockés hashés**, jamais en clair (#122).
- **`POST /api/games` ne fait pas confiance au client** : l'Elo et l'historique
  sont recalculés côté serveur (#116).
- **Rate-limit** des messages WebSocket (#124) et anti-brute-force login +
  honeypot inscription + cooldown « mot de passe oublié » (#86, #121).
- **Redaction des secrets dans les logs** (`backend/src/logger.js`).
- **En-têtes de sécurité + CSP** sur le HTML servi par nginx (#118,
  `frontend/security-headers.conf`).

## Décision : stockage du JWT côté client (#119)

Le JWT est conservé en **`localStorage`** (`frontend/src/store/authStore.ts`,
clé `chouine-auth`). C'est un choix **assumé**, jugé acceptable au vu des
défenses en place :

1. **CSP stricte** sur le HTML (#118) : `script-src 'self'`, pas de script inline
   → réduit fortement la surface d'exécution d'un XSS (vecteur de vol du token).
2. **Révocation par `token_version`** (#117) : un token compromis est invalidé
   dès le prochain changement de mot de passe, et toute la famille de tokens
   l'est en cas de réinitialisation.

### Limites connues / pistes (par coût croissant)

- **Durée de vie** : les JWT valent 7 jours (`JWT_EXPIRES_IN`). À réduire (≈ 24 h)
  une fois une reconnexion silencieuse en place.
- **Cookie `httpOnly` + CSRF** : protège du vol par XSS, mais alourdit le flux
  (CSRF, impact sur l'authentification WebSocket). Non retenu pour l'instant ;
  à réévaluer si la surface XSS augmente.

Cette décision est à **réévaluer** si la CSP doit être assouplie ou si un
incident XSS survient.

## Notes

- Authentification WebSocket : voir l'évolution du transport du token hors de
  l'URL (#120) pour éviter la fuite dans les logs des proxys.
- Captcha optionnel (Cloudflare Turnstile) activable par configuration (#104).
