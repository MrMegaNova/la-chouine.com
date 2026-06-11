# ─── Dépendances ──────────────────────────────────────────────────────────────
FROM node:26-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci && npm cache clean --force

# ─── Build production ─────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN npm run build

# ─── Serve (production) ───────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
