# la-chouine.com

Jeu de cartes français (la Chouine) en ligne, jouable contre l'IA ou en PvP classé.

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

1. **Double moteur.** Toute règle de jeu modifiée dans `engine.ts` doit l'être à l'identique dans `engine.js` (et inversement). Une divergence casse silencieusement le PvP. → agent `engine-parity`.
2. **Tests backend en parallèle sur DB partagée.** `node --test tests/*.test.js` lance chaque fichier dans un process séparé sur la **même** base. Chaque fichier doit utiliser un **domaine email distinct** (`@<fichier>.invalid`, ex. `@gamesroute.invalid`) car le cleanup (`DELETE ... ILIKE '%@domaine'`) d'un fichier supprimerait sinon les lignes d'un autre → CI rouge intermittent. Supprimer les `games` **avant** les `users` (FK). → agent `backend-test-runner`.

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

## Prod

Client → Traefik (forward headers) → nginx (conteneur frontend : SPA + proxy `/api` et `/ws`) → backend Express. `trust proxy` = 2 (chaîne à 2 proxies).
