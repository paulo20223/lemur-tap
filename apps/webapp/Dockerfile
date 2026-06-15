# Multi-stage build for @lemur/webapp (Vite SPA, pnpm workspaces).
# Build context is the repo root (see compose.prod.yml).
# Output is static assets served by nginx, which also proxies /api -> api:3000.

FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

# ── Dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/webapp/package.json apps/webapp/
RUN pnpm install --frozen-lockfile=false

# ── Build ───────────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/webapp apps/webapp
RUN pnpm -F @lemur/shared build
# VITE_API_BASE is empty by default => relative /api/v1 paths (same origin).
RUN pnpm -F @lemur/webapp exec vite build

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM nginx:alpine AS runtime
COPY apps/webapp/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/webapp/dist /usr/share/nginx/html
EXPOSE 80
