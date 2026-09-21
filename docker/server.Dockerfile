# Dev image for the NestJS server.
# Single stage on purpose: this is a development image, not a release artifact.
# A production image would use a multi-stage build with `pnpm deploy --prod`.

FROM node:24-alpine AS dev

# `postgres` and `sharp` (if added later) need these at install time.
RUN apk add --no-cache libc6-compat

RUN corepack enable

WORKDIR /usr/src/app

# Copy only manifests first so the dependency layer caches independently of
# source changes. Every workspace manifest is needed: pnpm resolves the lockfile
# for the whole repo even when it only installs one filter.
COPY package.json pnpm-workspace.yaml .npmrc ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/cli/package.json ./packages/cli/package.json

RUN pnpm install --filter server... --frozen-lockfile=false

COPY . .

EXPOSE 2283

CMD ["pnpm", "--filter", "server", "run", "dev"]
