# Dev image for the SvelteKit web app.
# Same single-stage rationale as the server image.
#
# Note: the web app depends on `@immich/sdk` through `workspace:*`, so the SDK
# manifest has to be copied before `pnpm install` resolves the workspace.

FROM node:24-alpine AS dev

RUN corepack enable

WORKDIR /usr/src/app

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/cli/package.json ./packages/cli/package.json

RUN pnpm install --filter web... --frozen-lockfile=false

COPY . .

EXPOSE 3000

CMD ["pnpm", "--filter", "web", "run", "dev"]
