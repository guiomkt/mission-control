# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for Mission Control.
#
# Layout:
#   deps     → install production + dev deps (needed for next build)
#   builder  → run `next build` (produces .next/standalone/)
#   runner   → minimal runtime, runs as non-root, only the standalone tree
#
# better-sqlite3 is a native dep; it needs build tools at compile time and
# libstdc++ at runtime. node:22-alpine + build-base covers both.

ARG NODE_VERSION=22-alpine

# ── deps ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ── builder ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# ── runner ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

# libstdc++ for better-sqlite3 at runtime; tini for proper signal handling;
# wget for the healthcheck (busybox wget is already in -alpine, listing
# explicitly anyway); su-exec so the entrypoint can drop privileges to
# `node` (uid 1000) after fixing volume permissions.
RUN apk add --no-cache libstdc++ tini wget su-exec

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Runtime user. We need uid:gid that matches the OpenClaw data volume on the
# host (owned by `ubuntu` uid=1000 with mode 700). The node:22-alpine image
# ships a `node` user at uid 1000 / gid 1000, which is exactly what we want.
# Stick with it to keep volume permissions predictable across hosts.

# Public assets + Next.js' standalone server.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Writable data dir for audit log and any future SQLite files. Compose may
# replace this with a named volume; the entrypoint re-chowns it on boot
# so we recover gracefully from a pre-existing volume owned by some other uid.
RUN mkdir -p /app/data && chown -R node:node /app/data

# Entrypoint runs as root, fixes data-dir ownership, then drops to `node`.
COPY --chmod=755 docker/entrypoint.sh /entrypoint.sh

EXPOSE 3000

# Cheap liveness check; the panel renders /login without auth for unauthenticated requests.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/login || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["node", "server.js"]
