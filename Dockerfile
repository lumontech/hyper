# ─────────────────────────────────────────────────────────────────────
# Hyperliquid Platform — multi-stage Dockerfile
#   Stage 1: build frontend Vite con path-prefix configurabile
#   Stage 2: install backend prod deps + copia sorgenti + frontend statico
#   Stage 3: runtime Node 22 alpine
# ─────────────────────────────────────────────────────────────────────

# Build args (overridabili da docker compose):
#   VITE_BASE      → base path es. /hyperliquid/  (default /)
#   VITE_API_BASE  → API URL es. ''(stesso origine) o 'https://miosito.com/hyperliquid'
ARG VITE_BASE=/
ARG VITE_API_BASE=

# ── Stage 1: build frontend ──────────────────────────────────────────
FROM node:22-alpine AS web-build
ARG VITE_BASE
ARG VITE_API_BASE
ENV VITE_BASE=${VITE_BASE}
ENV VITE_API_BASE=${VITE_API_BASE}
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build
# Output in /app/web/dist (path-prefix applicato come da VITE_BASE)

# ── Stage 2: install backend ─────────────────────────────────────────
FROM node:22-alpine AS backend-install
WORKDIR /app
COPY package.json package-lock.json* ./
# tsx serve come runtime, è in devDeps; servono entrambi
RUN npm ci --no-audit --no-fund

# ── Stage 3: runtime ────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache tini curl
# Copia node_modules completo
COPY --from=backend-install /app/node_modules ./node_modules
# Copia sorgenti
COPY package.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
# Copia frontend buildato — il backend lo serve via @fastify/static
COPY --from=web-build /app/web/dist ./web-dist

RUN mkdir -p /app/data/audit /app/data/results && chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV LOG_PRETTY=false
ENV API_BIND=0.0.0.0
ENV API_PORT=7777
ENV WEB_DIST_PATH=/app/web-dist
ENV DB_PATH=/app/data/bot.db
ENV AUDIT_LOG_PATH=/app/data/audit/signed-payloads.log

EXPOSE 7777
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:7777/status || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "tsx/esm", "src/orchestrator/main.ts"]
