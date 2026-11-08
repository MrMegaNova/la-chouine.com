# Connexion avec Google, Facebook ou Apple

Ce guide explique comment activer les boutons « Continuer avec Google / Facebook / Apple » de la page de connexion.

**Chaque fournisseur est facultatif.** Un fournisseur dont les variables d'environnement sont vides, ou incomplètes, n'est pas proposé : son bouton n'apparaît pas, et son adresse de départ renvoie sur une page d'erreur. On peut donc n'activer que Google, ou que Google et Facebook.

| Fournisseur | Coût | Variables |
|---|---|---|
| Google | gratuit | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Facebook | gratuit | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` |
| Apple | Apple Developer Program, 99 $ par an | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` |

Dans tous les cas, il faut aussi renseigner `OAUTH_REDIRECT_BASE`.

## Adresses de retour

`la-chouine.com` redirige vers `www.la-chouine.com`. Les adresses de retour doivent donc utiliser **`www`**. Sinon, le cookie posé au départ de la connexion n'est pas renvoyé au retour, et le joueur voit « La connexion a expiré ou a été ouverte dans un autre navigateur ».

| Fournisseur | Adresse de retour à déclarer |
|---|---|
| Google | `https://www.la-chouine.com/api/auth/oauth/google/callback` |
| Facebook | `https://www.la-chouine.com/api/auth/oauth/facebook/callback` |
| Apple | `https://www.la-chouine.com/api/auth/oauth/apple/callback` |

Pour tester sur la pile de développement, déclarer aussi les mêmes chemins sur `http://localhost:5173` (voir [Tester en local](#tester-en-local)).

Ces pages publiques du site sont demandées par les fournisseurs :

- page d'accueil : `https://www.la-chouine.com/`
- règles de confidentialité : `https://www.la-chouine.com/confidentialite`
- suppression des données : `https://www.la-chouine.com/confidentialite`. La page explique que le compte se supprime depuis le profil, ou sur demande par email.

## Google

1. Ouvrir la [Google Cloud Console](https://console.cloud.google.com/) et créer un projet, par exemple « La Chouine ».
2. Aller dans **Google Auth Platform**, anciennement « Écran de consentement OAuth ».
   - **Branding** : nom de l'application « La Chouine », adresse d'assistance, logo (facultatif), page d'accueil, lien vers les règles de confidentialité, et domaine autorisé `la-chouine.com`.
   - **Audience** : type **Externe**, puis **Publier l'application** pour passer en production. Sans cette étape, seuls les comptes de test déclarés peuvent se connecter.
   - **Accès aux données** : rien à ajouter. Les portées utilisées (`openid`, `email`, `profile`) sont de base et ne demandent pas de validation par Google. Si un logo est fourni, Google peut en vérifier la marque, ce qui prend quelques jours.
3. Aller dans **Clients**, puis **Créer un client**.
   - Type : **Application Web**.
   - Origines JavaScript autorisées : aucune, la connexion passe par le serveur.
   - URI de redirection autorisés : `https://www.la-chouine.com/api/auth/oauth/google/callback`. Ajouter `http://localhost:5173/api/auth/oauth/google/callback` pour tester en local.
4. Copier l'**ID client** dans `GOOGLE_CLIENT_ID` et le **code secret** dans `GOOGLE_CLIENT_SECRET`.

Ce que le site reçoit de Google : un identifiant stable, l'adresse email avec l'indication qu'elle est confirmée, et le prénom, proposé comme pseudo.

## Facebook

1. Sur [developers.facebook.com](https://developers.facebook.com/), créer une application.
   - Cas d'usage : **« Authentifier et demander des données aux utilisateurs avec Facebook Login »**.
   - Type d'application : **Consommateur**, si la question est posée.
2. Dans le cas d'usage Facebook Login, **Personnaliser** :
   - Autorisations : ajouter **`email`**. `public_profile` est déjà présent.
   - **Paramètres** :
     - **Connexion OAuth cliente** : oui.
     - **Connexion OAuth web** : oui.
     - **Mode strict pour les URI de redirection** : oui.
     - **URI de redirection OAuth valides** : `https://www.la-chouine.com/api/auth/oauth/facebook/callback`. En mode développement, Facebook accepte `http://localhost` sans déclaration.
3. Dans **Paramètres de l'application**, puis **Général** :
   - domaine de l'application : `la-chouine.com` ;
   - URL des règles de confidentialité et URL des instructions de suppression des données : `https://www.la-chouine.com/confidentialite` ;
   - catégorie (Jeux) et icône 1024 × 1024.
4. Copier l'**ID de l'application** dans `FACEBOOK_APP_ID` et la **clé secrète** dans `FACEBOOK_APP_SECRET`.
5. **Publier** l'application : passer du mode « Développement » au mode « Live ». En mode Développement, seuls les administrateurs et testeurs de l'application peuvent se connecter. `email` et `public_profile` relèvent de l'accès standard : ni examen de l'application ni vérification d'entreprise ne sont demandés.

Ce que le site reçoit de Facebook : un identifiant propre à l'application, le prénom, et l'adresse email si le joueur en a une et l'autorise.

À savoir :

- Facebook ne garantit pas que l'adresse transmise a été confirmée. Elle n'est donc **jamais** utilisée pour rattacher un compte existant : un joueur qui a déjà un compte avec cette adresse voit « Un compte existe déjà avec cette adresse email » et doit se connecter avec son pseudo.
- Sans adresse email (compte Facebook créé avec un numéro de téléphone, ou email refusé), l'inscription est impossible. Le joueur voit un message qui l'invite à autoriser l'email ou à s'inscrire avec un pseudo.

## Apple (facultatif, payant)

Nécessite une adhésion à l'**Apple Developer Program** (99 $ par an). Sans elle, laisser les variables `APPLE_*` vides : le bouton n'apparaît pas.

1. Sur [developer.apple.com](https://developer.apple.com/account), dans **Certificates, Identifiers & Profiles** :
   1. **Identifiers**, puis **App IDs** : créer un App ID, par exemple `com.la-chouine.app`, avec la capacité **Sign in with Apple**. Il sert de « primary App ID ».
   2. **Identifiers**, puis **Services IDs** : créer un Services ID, par exemple `com.la-chouine.web`. C'est l'**`APPLE_CLIENT_ID`**.
      - Activer **Sign in with Apple**, puis **Configure** : primary App ID ci-dessus, domaine `www.la-chouine.com`, Return URL `https://www.la-chouine.com/api/auth/oauth/apple/callback`.
      - Apple n'accepte que des adresses en HTTPS : pas de test sur `http://localhost`.
   3. **Keys** : créer une clé avec **Sign in with Apple**, liée au primary App ID, puis télécharger le fichier `.p8`. Il n'est téléchargeable qu'une fois.
2. Renseigner les variables :
   - `APPLE_CLIENT_ID` : le Services ID ;
   - `APPLE_TEAM_ID` : l'identifiant d'équipe, en haut à droite du compte développeur ;
   - `APPLE_KEY_ID` : l'identifiant de la clé ;
   - `APPLE_PRIVATE_KEY` : le contenu du `.p8`, sur une ligne, entre guillemets, chaque retour à la ligne remplacé par `\n`.

   Pour obtenir cette ligne :

   ```bash
   awk 'NF {printf "%s\\n", $0}' AuthKey_XXXXXXXXXX.p8
   ```

Ce que le site reçoit d'Apple : un identifiant stable, l'adresse email (éventuellement une adresse relais `@privaterelay.appleid.com` si le joueur masque la sienne), et le prénom, mais **seulement à la toute première autorisation**.

Pour qu'Apple puisse transmettre des emails vers une adresse relais (vérification, mot de passe oublié), il faut déclarer le domaine d'envoi `la-chouine.com` et l'adresse `contact@la-chouine.com` dans **Services**, puis **Sign in with Apple for Email Communication**.

## Déploiement

1. Ajouter les variables dans le `.env` de production, à côté de `docker-compose.yml`. Seules celles des fournisseurs voulus sont nécessaires :

   ```dotenv
   OAUTH_REDIRECT_BASE=https://www.la-chouine.com
   GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   FACEBOOK_APP_ID=123456789012345
   FACEBOOK_APP_SECRET=...
   ```

2. Relancer le backend :

   ```bash
   docker compose up -d backend
   ```

3. Vérifier les fournisseurs actifs :

   ```bash
   curl -s https://www.la-chouine.com/api/auth/oauth/providers
   # {"providers":["google","facebook"]}
   ```

4. Faire un essai réel sur la page de connexion, avec un compte Google ou Facebook qui n'a pas encore de compte sur le site. On doit arriver sur « Choisissez votre pseudo », puis sur le profil, qui affiche « Connexion avec Google ».

Pour désactiver un fournisseur, vider ses variables et relancer le backend. Les joueurs déjà inscrits par ce fournisseur gardent leur compte. S'ils n'ont pas de mot de passe, « Mot de passe oublié » leur permet d'en créer un.

## Tester en local

La pile Docker de développement n'a pas ces variables. Pour tester Google ou Facebook en local :

1. Déclarer `http://localhost:5173/api/auth/oauth/google/callback` dans le client Google. Facebook accepte `localhost` en mode développement.
2. Créer un fichier d'override, non versionné :

   ```yaml
   # oauth.override.yml
   services:
     backend:
       environment:
         OAUTH_REDIRECT_BASE: http://localhost:5173
         GOOGLE_CLIENT_ID: ...
         GOOGLE_CLIENT_SECRET: ...
   ```

3. Relancer le backend avec cet override :

   ```bash
   docker compose -f docker-compose.dev.yml -f oauth.override.yml up -d --no-deps backend
   ```

Ouvrir le site sur `http://localhost:5173`, et non sur l'adresse IP de la machine : le cookie de connexion est `Secure`, et les navigateurs ne l'acceptent en HTTP que sur `localhost`.

## Dépannage

| Symptôme | Cause probable |
|---|---|
| Le bouton n'apparaît pas | Variables vides ou incomplètes : vérifier `/api/auth/oauth/providers` et `docker compose exec backend printenv \| grep -E 'GOOGLE\|FACEBOOK\|APPLE'`. |
| Google : `redirect_uri_mismatch` | L'URI de redirection déclarée ne correspond pas exactement à `OAUTH_REDIRECT_BASE` + `/api/auth/oauth/google/callback` (vérifier `www`, `https` et l'absence de `/` final). |
| Facebook : « URL bloquée » | Même cause : l'URI n'est pas dans les « URI de redirection OAuth valides ». |
| « La connexion a expiré ou a été ouverte dans un autre navigateur » | `OAUTH_REDIRECT_BASE` sur un autre domaine que celui du site (`la-chouine.com` au lieu de `www`), cookies bloqués, connexion commencée depuis plus de 10 minutes, ou retour ouvert dans un autre navigateur (lien copié depuis une application). |
| « La connexion n'a pas abouti » | Le fournisseur a refusé l'échange du code : secret erroné, ou clé Apple invalide. Le motif est dans les journaux du backend (`docker compose logs backend \| grep oauth`). |
| « Un compte existe déjà avec cette adresse email » | Adresse déjà utilisée par un compte du site, et fournisseur qui ne garantit pas l'adresse (Facebook) : le joueur se connecte avec son pseudo. |
| Google : seuls certains comptes peuvent se connecter | Application restée en mode « Test » dans **Audience** : la publier. |
| Facebook : seuls les administrateurs peuvent se connecter | Application restée en mode « Développement » : la passer en « Live ». |

## Fonctionnement technique

Résumé pour la maintenance. Le détail est dans `backend/src/routes/oauth.js` et `backend/src/services/oauth.js`.

1. `GET /api/auth/oauth/:provider` : un état à usage unique (state, nonce, vérificateur PKCE, code d'invitation) est gardé 10 minutes dans Redis. Le cookie `chouine_oauth` (HttpOnly, Secure, SameSite=None) lie la connexion au navigateur. Puis redirection vers le fournisseur.
2. `GET|POST /api/auth/oauth/:provider/callback` : contrôle du state et du cookie, échange du code contre l'identité, puis redirection vers `/connexion/retour` :
   - **joueur connu** : `?code=…`, un code de connexion à usage unique (2 minutes) que le site échange contre le JWT (`POST /exchange`) ;
   - **nouveau joueur** : `?inscription=…`, le joueur choisit son pseudo (`GET /signup`, `POST /complete`), puis le compte est créé, vérifié, sans mot de passe ;
   - **échec** : `?erreur=annule|etat|fournisseur|email|compte`.
3. Rattachement d'un compte existant par son adresse email : seulement si Google ou Apple garantissent l'adresse. Un compte jamais activé ainsi rattaché perd son mot de passe et ses sessions, car ce mot de passe a pu être choisi par quelqu'un d'autre que le propriétaire de l'adresse.

Les comptes rattachés sont dans la table `user_identities` (migration `014`). `users.password_hash` vaut `NULL` pour un compte créé par un fournisseur.
