# La Chouine

Application web pour jouer à **La Chouine**, le jeu de cartes historique de la Vallée du Loir. Jouez contre l'ordinateur, en local ou entre amis.

[![CI](https://github.com/MrMegaNova/la-chouine.com/actions/workflows/ci.yml/badge.svg)](https://github.com/MrMegaNova/la-chouine.com/actions/workflows/ci.yml)

## Fonctionnalités

- Jeu à 2, 3 ou 4 joueurs
- Variante **Classique** et **Mondoubleau** (sans retourne)
- Trois modes : contre l'ordinateur, en local (même appareil), entre amis en ligne
- Inscription avec vérification par email
- Historique des parties et profil joueur
- Système d'amis (invitations, acceptation)

## Stack technique

| Couche | Technologie |
|---|---|
| Frontend | React 18 + TypeScript + Vite + SCSS |
| Backend | Node.js 24 + Express 4 |
| Base de données | PostgreSQL 16 |
| Auth | JWT + bcrypt |
| Email | Nodemailer (`contact@la-chouine.com`) |
| CI | GitHub Actions |

## Structure du projet

```
la-chouine.com/
├── frontend/          # React + TypeScript (Vite)
│   └── src/
│       ├── game/      # Moteur de jeu pur (engine.ts, ai.ts, types.ts)
│       ├── store/     # État global Zustand (gameStore, authStore)
│       ├── api/       # Client API typé
│       ├── components/# Composants React (GameTable, PlayingCard…)
│       ├── pages/     # Pages (Home, Play, Profile, Friends, Rules)
│       └── styles/    # SCSS global + partials
├── backend/           # Node.js + Express
│   ├── src/
│   │   ├── routes/    # auth, users, friends, games
│   │   ├── middleware/# JWT, rate-limiter
│   │   └── services/  # email (nodemailer)
│   ├── migrations/    # Schéma SQL (PostgreSQL)
│   └── tests/         # Tests Node.js natifs
├── .github/workflows/ # CI GitHub Actions
└── regles_chouine.pdf # Règles officielles du jeu
```

## Démarrage rapide

### Avec Docker (recommandé)

```bash
# Dev — hot reload, MailHog pour les emails
docker compose up

# Frontend   → http://localhost:5173
# Backend    → http://localhost:3000
# MailHog    → http://localhost:8025  (emails de vérification)
```

Les migrations de base de données sont exécutées automatiquement au démarrage du backend.

### Sans Docker

#### Prérequis : Node.js 24+, PostgreSQL 16+

```bash
# Backend
cd backend && cp .env.example .env   # remplir les variables
npm install && npm run migrate && npm start   # http://localhost:3000

# Frontend (autre terminal)
cd frontend && npm install && npm run dev     # http://localhost:5173
```

### Production (Docker)

```bash
cp .env.example .env      # remplir toutes les variables
docker compose -f docker-compose.prod.yml up -d
# L'application est disponible sur http://localhost:80
```

Les images Docker sont disponibles sur [GitHub Container Registry](https://github.com/MrMegaNova/la-chouine.com/pkgs/container) après chaque release.

### Build frontal manuel

```bash
cd frontend && npm run build   # → frontend/dist/
```

## Configuration backend (`.env`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | URL PostgreSQL (`postgresql://user:pass@host/db`) |
| `JWT_SECRET` | Clé secrète JWT (min. 64 caractères aléatoires) |
| `JWT_EXPIRES_IN` | Durée de validité des tokens (défaut : `7d`) |
| `SMTP_HOST` | Serveur SMTP |
| `SMTP_PORT` | Port SMTP (défaut : `587`) |
| `SMTP_USER` | Adresse expéditeur |
| `SMTP_PASS` | Mot de passe SMTP |
| `FRONTEND_URL` | URL du frontend (pour les liens dans les emails) |

Générer un `JWT_SECRET` :
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## Règles du jeu

Les règles complètes sont disponibles dans [`regles_chouine.pdf`](regles_chouine.pdf) et résumées dans l'application (onglet **Règles**).

### En bref

- 32 cartes, ordre de force : **As > 10 > Roi > Dame > Valet > 9 > 8 > 7**
- Les **As** et **Dix** sont les brisques (points)
- Tant qu'il reste du talon, jeu libre. Talon vide : fournir, monter, couper
- Annonces en gagnant la main : mariage, tierce, quarteron, quinte, chouine
- Égalité de points → coup nul, même donneur
- **Mondoubleau** : pas de retourne, l'atout est fixé par la première annonce

## Contribution

1. Forkez le dépôt
2. Créez une branche (`git checkout -b feature/ma-fonctionnalite`)
3. Committez (`git commit -m 'feat: ...'`)
4. Ouvrez une Pull Request vers `main`

Le CI vérifie automatiquement : compilation TypeScript, build Vite, tests backend, audit de sécurité npm.

## Licence

Open source — voir [LICENSE](LICENSE) si présent.

---

*Jeu historique de la Vallée du Loir · Championnat du monde à Lavardin (Loir-et-Cher)*
