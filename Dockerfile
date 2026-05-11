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
# explicitly anyway).
RUN apk add --no-cache libstdc++ tini wget

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user. UID/GID kept stable so volume permissions are predictable.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Public assets + Next.js' standalone server.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Writable data dir for audit log and any future SQLite files. Compose may
# replace this with a named volume; the chown survives because the image
# ships an empty dir owned by the runtime user.
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000

# Cheap liveness check; the panel renders /login without auth for unauthenticated requests.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/login || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
