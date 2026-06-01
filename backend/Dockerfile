# ─── Dépendances ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci && npm cache clean --force

# ─── Production ───────────────────────────────────────────────────────────────
FROM node:24-alpine AS prod
WORKDIR /app

RUN apk add --no-cache dumb-init

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/
COPY migrations/ ./migrations/
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
USER node

ENTRYPOINT ["dumb-init", "--", "./docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
