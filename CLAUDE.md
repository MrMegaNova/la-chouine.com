# la-chouine.com

Jeu de cartes français (la Chouine) en ligne, jouable contre l'IA ou en PvP classé.

**Deux variantes** : `classic` et `mondoubleau` (liste `VALID_VARIANTS` dans `backend/src/routes/games.js`). L'Elo est **séparé par variante** (`rating_classic`, `rating_mondoubleau`) : un classement ne se mélange jamais avec l'autre. Le minutage des coups classés vit dans `backend/src/game/turnClock.js` (fonction pure, `now` injecté → testable : base par coup + réserve commune, pause à la déconnexion, anti-stall).

## Stack

- **Frontend** : Vite 5, React 18, TypeScript, Zustand (+ persist), React Router v6, SCSS, Vitest.
  - `frontend/src/game/engine.ts` — moteur de jeu (TS).
  - `frontend/src/store/` — stores Zustand (`gameStore`, `onlineStore`, `authStore`, `soundStore`).
- **Backend** : Node 24, Express 4, PostgreSQL (`pg`), WebSocket (`ws`), JWT, bcryptjs, nodemailer, pino.
  - `backend/src/game/engine.js` — moteur de jeu (JS), **doit rester synchrone avec le moteur TS**.
  - `backend/src/game/session.js` — `GameSession` autoritatif (PvP en mémoire).
  - `backend/src/wsServer.js`, `sessionRegistry`, `matchmaking` — serveur temps réel.
  - `backend/migrations/NNN_*.sql` — migrations, appliquées par `node src/db/migrate.js`.

## ⚠️ Pièges à connaître

1. **Double moteur.** Toute règle de jeu modifiée dans `engine.ts` doit l'être à l'identique dans `engine.js` (et inversement). Une divergence casse silencieusement le PvP. Attention : le moteur gère **deux variantes** (`classic` et `mondoubleau`), et `mondoubleau` a des branches propres (phase sans atout) — la parité doit couvrir ces branches, pas seulement la variante classique. → agent `engine-parity`.
2. **Tests backend en parallèle sur DB partagée.** `node --test tests/*.test.js` lance chaque fichier dans un process séparé sur la **même** base. Chaque fichier doit utiliser un **domaine email distinct** (`@<fichier>.invalid`, ex. `@gamesroute.invalid`) car le cleanup (`DELETE ... ILIKE '%@domaine'`) d'un fichier supprimerait sinon les lignes d'un autre → CI rouge intermittent. Supprimer les `games` **avant** les `users` (FK + contrainte `must_have_identity`). En prod, la suppression d'un utilisateur est gérée par le trigger `trg_pseudonymize_user_games` (migration `006`) qui pseudonymise ses sièges au lieu de violer la contrainte ; le cleanup des tests, lui, supprime explicitement dans le bon ordre. → agent `backend-test-runner`.

## Commandes

```bash
# Backend
cd backend && npm test        # node --test (charge .env.test si présent)
cd backend && npm run dev

# Frontend
cd frontend && npm run build  # tsc && vite build (le tsc bloque sur erreurs de type)
cd frontend && npm test       # vitest run
cd frontend && npm run dev
```

## Workflow (issue → PR → release)

1. **Issue** en français (contexte, repro/attendu, critères d'acceptation). → agent `issue-author`.
2. **Branche** dédiée (`fix/...`, `feat/...`) — jamais de commit direct sur `main`.
3. **Commits** en français, terminés par `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
4. **PR** : corps en français + `Closes #NN` + footer `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Pour une épopée à checklist : référencer l'issue sans la fermer.
5. **Merge** `--delete-branch`, puis `gh run watch` jusqu'au vert.
6. **Release** : tag prerelease via `gh release create vX.Y.Z --target main --prerelease` (changelog FR). La version dans `package.json` reste `1.0.0` — le versioning vit dans les tags Git (dernier : v0.5.15). → agent `release-shepherd`.

## CI (GitHub Actions)

Sur push `main` ET pull_request : jobs **Backend** (+ Postgres, `NODE_ENV=test`), **Frontend** (build + vitest), **npm-audit**.

## Sous-agents (`.claude/agents/`)

- `feature-dev` — prend une issue, la développe sur une branche, ouvre la PR.
- `pr-reviewer` — relit + teste une PR (parité moteurs, isolation tests, sécu).
- `engine-parity` — vérifie la synchro `engine.ts` ↔ `engine.js`.
- `backend-test-runner` — lance/diagnostique `node --test` (isolation DB).
- `issue-author` — rédige une issue FR au style du repo.
- `release-shepherd` — PR → merge → CI → prerelease.

## Sécurité

Invariants déjà en place — **à ne pas régresser** :

- **Révocation JWT par `token_version`** : la colonne est incrémentée à chaque changement/réinitialisation de mot de passe, ce qui invalide tous les JWT émis avant (#117). Toute nouvelle route sensible doit vérifier `token_version`.
- **Tokens verify/reset stockés hashés**, jamais en clair (#122).
- **`POST /api/games` ne fait pas confiance au client** pour l'Elo ni l'historique : le serveur recalcule (#116). Ne jamais réintroduire de score fourni par le client.
- **Rate-limit des messages WebSocket** (anti-flood, #124) et **anti-brute-force login + honeypot inscription + cooldown forgot-password** (#86, #121).
- **Redaction des secrets dans les logs** (`backend/src/logger.js`, pino) : ne jamais logger token, mot de passe ou en-tête d'auth.

Dette connue (tracée, **ne pas réintroduire / penser à traiter**) : pas d'en-têtes de sécurité/CSP sur le HTML nginx (#118), JWT en `localStorage` exposé au XSS (#119), JWT passé dans l'URL WebSocket → fuite dans les logs proxys (#120), sonde de présence via les défis (#123), captcha d'inscription/login optionnel (#104).

## Dépendances

Dependabot est actif (npm ×2, docker ×3, github-actions). Les **bumps majeurs sont volontairement différés** et regroupés dans l'épopée #33 : React 19 (#40), Express 5 + helmet 8 + rate-limit 8 + bcryptjs 3 (#41), Vite 8 + vitest 4 (#39), TypeScript 6 (#42), Node 26 (#53). **Ne pas merger ces PR Dependabot majeures** isolément — elles attendent le traitement de l'épopée. Les minors/patches passent normalement.

## Prod

Client → Traefik (forward headers) → nginx (conteneur frontend : SPA + proxy `/api` et `/ws`) → backend Express. `trust proxy` = 2 (chaîne à 2 proxies).
