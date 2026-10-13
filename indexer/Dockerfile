# Collector image. Build from the repository root:
#   docker build -f indexer/Dockerfile -t am-i-linkable-indexer .
# Secrets are provided at runtime as environment variables, never baked in.

FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
# Manifests first, so dependency layers are cached between source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY indexer/package.json indexer/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@ail/indexer..."
COPY packages/core packages/core
COPY indexer indexer
# Self-contained production bundle: indexer + @ail/core + runtime dependencies only.
RUN pnpm --filter @ail/indexer deploy --prod /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
CMD ["node", "--import", "tsx", "src/start.ts"]
