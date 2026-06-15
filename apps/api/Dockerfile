# Multi-stage build for @lemur/api (NestJS, ESM, pnpm workspaces).
# Build context is the repo root (see docker-compose.yml).

FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

# ── Dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile=false

# ── Build ───────────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm -F @lemur/shared build
RUN pnpm -F @lemur/api prisma:generate
RUN pnpm -F @lemur/api build

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/node_modules apps/api/node_modules

WORKDIR /app/apps/api
EXPOSE 3000
# Apply pending migrations then start.
CMD ["sh", "-c", "node ../../node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
