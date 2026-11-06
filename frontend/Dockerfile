# ─── Dépendances ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci && npm cache clean --force

# ─── Build production ─────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# Version de la release (passée par release.yml), affichée sur le tableau de
# bord administrateur.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build

# ─── Serve (production) ───────────────────────────────────────────────────────
FROM nginx:1.31-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
