# ─── Dépendances ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci && npm cache clean --force

# ─── Géolocalisation (#311) ───────────────────────────────────────────────────
# Base libre DB-IP Lite (ville, CC BY 4.0), publiée chaque mois : celle du mois,
# sinon celle du mois précédent. Si le téléchargement échoue, l'image est quand
# même construite et les visites sont enregistrées sans localisation.
FROM alpine:3 AS geo
RUN apk add --no-cache curl \
 && mkdir -p /geo && cd /geo \
 && for m in "$(date -u +%Y-%m)" "$(date -u -d "@$(( $(date +%s) - 2678400 ))" +%Y-%m)"; do \
      curl -fsSL "https://download.db-ip.com/free/dbip-city-lite-$m.mmdb.gz" | gunzip > dbip-city-lite.mmdb \
        && [ -s dbip-city-lite.mmdb ] && echo "DB-IP $m" && break; \
      rm -f dbip-city-lite.mmdb; \
    done; \
    [ -s dbip-city-lite.mmdb ] || echo "AVERTISSEMENT : base DB-IP indisponible, localisation désactivée"

# ─── Production ───────────────────────────────────────────────────────────────
FROM node:24-alpine AS prod
WORKDIR /app

RUN apk add --no-cache dumb-init

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/
COPY migrations/ ./migrations/
COPY --from=geo /geo/ ./geo/
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
USER node

ENTRYPOINT ["dumb-init", "--", "./docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
