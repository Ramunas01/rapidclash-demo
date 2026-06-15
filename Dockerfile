# syntax=docker/dockerfile:1
#
# One container, one origin (ADR-009): builds the PWA + the server, then ships a slim
# runtime that serves the REST API, the WebSocket, and the built PWA together.
#
#   docker build -t rapidclash .
#   docker run --rm -p 8080:8080 -e PORT=8080 -e ADMIN_PASSWORD=dev rapidclash

# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
# better-sqlite3 compiles a native addon if no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Whole monorepo (node_modules/dist excluded via .dockerignore).
COPY . .

# Install all deps (dev included — needed to build), then build both halves:
#   - the PWA → apps/web/dist (vite + vite-plugin-pwa: sw.js, manifest, icons)
#   - the server + workspace packages → dist (tsc -b)
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rapidclash/web build
RUN pnpm run build

# Self-contained, production-only deploy of the server: its dist + prod deps + the
# workspace packages' dists, hard-copied (no symlinks into the pnpm store).
RUN pnpm --filter=@rapidclash/server deploy --prod /prod/server

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
# Cloud Run injects PORT=8080; default it for a plain `docker run`.
ENV PORT=8080
# SQLite is ephemeral (ADR-009); /tmp is always writable.
ENV DB_PATH=/tmp/rapidclash.db
WORKDIR /app

# The server package (package.json + dist + node_modules) lands at /app.
COPY --from=builder /prod/server ./
# The built PWA, served on the same origin; point the server at it.
COPY --from=builder /app/apps/web/dist ./web/dist
ENV WEB_DIST=/app/web/dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
