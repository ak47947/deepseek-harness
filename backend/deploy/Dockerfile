FROM node:24.22.1-bookworm-slim AS build
ARG DSH_CLIENT_COMMIT_HASH
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY . .
RUN corepack enable && corepack prepare pnpm@11.28.5 --activate
RUN --mount=type=cache,id=dsh-enterprise-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline --store-dir=/pnpm/store --package-import-method=copy --network-concurrency=8
RUN pnpm run build:artifacts

FROM node:24.22.1-bookworm-slim
WORKDIR /workspace
COPY --from=build --chown=node:node /workspace /workspace
RUN mkdir -p /data/harness && chown -R node:node /data
USER node
ENV NODE_ENV=production DSH_HOME=/data/harness
EXPOSE 3090
CMD ["sh", "-c", "node --import tsx/esm backend/deploy/init-profile.ts && exec node apps/cli/lib/bin.js --profile enterprise"]
