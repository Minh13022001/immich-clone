# Immich — Project Structure Export (for AI Agents)

> **Purpose:** This document describes the complete structure, tech stack, and conventions of the
> Immich monorepo so that an AI agent can scaffold a structurally-identical clone from scratch.
> It is a **blueprint**, not source code. Do not copy implementation code from the original repo.
>
> **Version reference:** `3.2.0-rc.0`

---

## 1. Tech Stack (exact)

| Layer                  | Technology                             | Version                |
| :--------------------- | :------------------------------------- | :--------------------- |
| Runtime                | Node.js                                | `24.15.0`              |
| Package manager        | pnpm (workspaces)                      | `11.22.0`              |
| Tool/task runner       | mise                                   | `monorepo_root = true` |
| Server framework       | NestJS                                 | `^11.0.4`              |
| HTTP adapter           | Express                                | `^5.1.0`               |
| Query builder          | Kysely                                 | `0.28.17`              |
| SQL tooling            | `@immich/sql-tools`                    | `^0.6.3`               |
| Validation / DTO       | Zod + `nestjs-zod`                     | `4.4.3` / `^5.5.0`     |
| Queue                  | BullMQ + Redis (`ioredis`)             | `^5.51.0`              |
| Realtime               | Socket.IO + `@socket.io/redis-adapter` | `^4.8.1`               |
| Observability          | OpenTelemetry + `nestjs-otel`          | `^0.221.0`             |
| CLI framework          | `nest-commander`                       | `^3.16.0`              |
| Database               | PostgreSQL (VectorChord + pgvecto.rs)  | `14`                   |
| Web framework          | SvelteKit + Svelte 5 (runes)           | `^2.56.1` / `5.56.9`   |
| Web build              | Vite                                   | `^8.0.0`               |
| CSS                    | Tailwind CSS                           | `^4.2.4`               |
| Web UI kit             | `@immich/ui`                           | `^0.86.0`              |
| ML service             | Python + FastAPI + ONNX                | —                      |
| Mobile                 | Flutter / Dart                         | —                      |
| API contract           | OpenAPI → generated SDK (`oazapfts`)   | —                      |
| Unit/integration tests | Vitest                                 | `^4.0.0`               |
| E2E tests              | Playwright                             | —                      |

---

## 2. Root Directory Layout

```
immich/
├── .devcontainer/          # Dev container definitions
├── .github/                # GitHub templates + CI workflows (a pnpm workspace package)
├── .vscode/                # Editor settings + debug launch profiles
├── deployment/             # Terraform/OpenTofu deployment configs (mise config root)
├── design/                 # Logos, screenshots for README
├── docker/                 # Docker Compose files (dev, prod, rootless) + example.env
├── docs/                   # Docusaurus documentation site (pnpm workspace package)
├── e2e/                    # Playwright end-to-end tests (pnpm workspace package)
├── fastlane/               # Android/iOS release metadata
├── i18n/                   # Translation JSON files (pnpm workspace package)
├── machine-learning/       # Python FastAPI ML service (mise config root)
├── misc/                   # Release note templates
├── mobile/                 # Flutter mobile app (mise config root)
├── open-api/               # OpenAPI spec + SDK generation templates
├── packages/               # Shared workspace packages (see §4)
├── readme_i18n/            # Translated README files
├── server/                 # NestJS backend (pnpm workspace package)
├── web/                    # SvelteKit frontend (pnpm workspace package)
├── .editorconfig
├── .gitattributes
├── .gitignore
├── .gitmodules
├── .nvmrc                  # 24.15.0
├── .pnpmfile.cjs           # pnpm hooks
├── .prettierrc
├── CODEOWNERS
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── SECURITY_REPORT.md
├── install.sh
├── mise.lock               # Auto-generated tool lockfile
├── mise.toml               # Tool versions + monorepo task definitions
├── package.json            # Root workspace manifest (private, type: module)
├── pnpm-lock.yaml
├── pnpm-workspace.yaml     # Workspace package globs + overrides
└── renovate.json
```

### Root `package.json` (shape)

```json
{
  "devDependencies": {
    "prettier": "^3.8.3",
    "prettier-plugin-sort-json": "^4.2.0"
  },
  "engines": { "pnpm": ">=10.0.0" },
  "name": "immich-monorepo",
  "packageManager": "pnpm@11.22.0",
  "private": true,
  "scripts": {
    "format": "prettier --cache --check i18n/",
    "format:fix": "prettier --cache --write --list-different i18n"
  },
  "type": "module",
  "version": "3.2.0-rc.0"
}
```

### `pnpm-workspace.yaml` (shape)

```yaml
packages:
  - packages/**
  - docs
  - e2e
  - i18n
  - server
  - plugins
  - web
  - .github
  - packages/*
allowBuilds:
  bcrypt: true
  sharp: true
  "@tailwindcss/oxide": true
  # ...other native deps set to false
overrides:
  canvas: 3.2.3
  sharp: ^0.35.3
packageExtensions:
  nestjs-kysely:
    dependencies: { tslib: "*" }
  nestjs-otel:
    dependencies: { tslib: "*" }
```

### `mise.toml` (shape)

```toml
monorepo_root = true

[monorepo]
config_roots = [
  "packages/plugin-core", "server", "packages/cli", "deployment",
  "mobile", "e2e", "web", "docs", ".github", "machine-learning",
]

[tools]
node = "24.15.0"
pnpm = "11.22.0"
"npm:@openapitools/openapi-generator-cli" = "2.40.1"
"npm:oazapfts" = "7.5.0"
java = "21.0.2"
# ...ffmpeg, extism, binaryen, terragrunt, opentofu

[settings]
pin = true
lockfile = true

[tasks.open-api]
run = [
  { task = "//:plugins" },
  { task = "//server:install" },
  { task = "//server:build" },
  { task = "//server:sync-open-api" },
  # ...generates TS + Dart SDKs
]
```

---

## 3. Server (`server/`) — NestJS Backend

### 3.1 Package manifest (shape)

```json
{
  "license": "GNU Affero General Public License version 3",
  "name": "immich",
  "private": true,
  "scripts": {
    "build": "nest build",
    "check": "tsc --noEmit",
    "email:dev": "email dev -p 3050 --dir src/emails",
    "lint": "eslint \"src/**/*.ts\" \"test/**/*.ts\" --max-warnings 0",
    "migrations:generate": "sql-tools -u ${DB_URL} migrations generate",
    "migrations:run": "sql-tools -u ${DB_URL} migrations run",
    "schema:reset": "pnpm run schema:drop && pnpm run migrations:run",
    "start:debug": "nest start --debug 0.0.0.0:9230 --watch --",
    "start:dev": "nest start --watch --",
    "test": "vitest --config test/vitest.config.mjs",
    "test:medium": "vitest --config test/vitest.config.medium.mjs"
  },
  "version": "3.2.0-rc.0"
}
```

**Key dependencies:** `@nestjs/{common,core,platform-express,platform-socket.io,schedule,swagger,websockets,bullmq}`,
`kysely`, `kysely-postgres-js`, `postgres`, `pg`, `nestjs-zod`, `zod`, `bullmq`, `ioredis`, `socket.io`,
`@socket.io/redis-adapter`, `@opentelemetry/*`, `nestjs-otel`, `nestjs-cls`, `nestjs-kysely`, `nest-commander`,
`bcrypt`, `jose`, `jsonwebtoken`, `sharp`, `exiftool-vendored`, `fluent-ffmpeg`, `archiver`, `multer`,
`nodemailer`, `react-email`, `luxon`, `lodash`, `uuid`, `semver`, `helmet`, `compression`, `cookie-parser`.

### 3.2 Source tree

```
server/
├── bin/
│   ├── immich-admin            # Admin CLI entrypoint
│   ├── immich-dev              # Dev entrypoint
│   ├── immich-healthcheck
│   ├── start.sh
│   └── get-cpus.sh
├── src/
│   ├── main.ts                 # Bootstrap: worker lifecycle manager (api/microservices/maintenance)
│   ├── app.module.ts           # Root module wiring (ApiModule, MicroservicesModule, AdminModule)
│   ├── app.common.ts           # Shared module config
│   ├── constants.ts            # DI tokens (e.g. IWorker)
│   ├── database.ts             # Domain types (AuthUser, AlbumUser, AssetFile, Library, ...)
│   ├── decorators.ts           # Custom decorators
│   ├── enum.ts                 # Enums (ImmichWorker, Permission, AssetType, ...)
│   ├── types.ts                # Shared TS types
│   ├── validation.ts           # Zod validation helpers
│   ├── bin/
│   │   ├── sync-open-api.ts    # Emits OpenAPI spec
│   │   └── sync-sql.ts         # Syncs SQL query files
│   ├── commands/               # nest-commander CLI commands
│   │   ├── index.ts
│   │   ├── grant-admin.ts
│   │   ├── list-users.command.ts
│   │   ├── maintenance-mode.ts
│   │   ├── media-location.command.ts
│   │   ├── oauth-login.ts
│   │   ├── password-login.ts
│   │   └── schema-check.ts
│   ├── controllers/            # HTTP endpoints (one per resource) + index.ts registry
│   │   ├── index.ts            # export const controllers = [...]
│   │   ├── activity.controller.ts
│   │   ├── album.controller.ts
│   │   ├── api-key.controller.ts
│   │   ├── app.controller.ts
│   │   ├── asset.controller.ts
│   │   ├── asset-file.controller.ts
│   │   ├── asset-media.controller.ts
│   │   ├── auth.controller.ts
│   │   ├── auth-admin.controller.ts
│   │   ├── config-{admin,public,user}.controller.ts
│   │   ├── download.controller.ts
│   │   ├── job.controller.ts
│   │   ├── library.controller.ts
│   │   ├── memory.controller.ts
│   │   ├── notification{,-admin}.controller.ts
│   │   ├── oauth.controller.ts
│   │   ├── partner.controller.ts
│   │   ├── person.controller.ts
│   │   ├── plugin.controller.ts
│   │   ├── queue.controller.ts
│   │   ├── search.controller.ts
│   │   ├── server.controller.ts
│   │   ├── session.controller.ts
│   │   ├── shared-link.controller.ts
│   │   ├── stack.controller.ts
│   │   ├── sync.controller.ts
│   │   ├── system-{config,metadata}.controller.ts
│   │   ├── tag.controller.ts
│   │   ├── timeline.controller.ts
│   │   ├── trash.controller.ts
│   │   ├── user.controller.ts
│   │   ├── user-admin.controller.ts
│   │   ├── video-stream.controller.ts
│   │   ├── view.controller.ts
│   │   └── workflow.controller.ts
│   ├── cores/                  # Cross-cutting core logic
│   │   └── storage.core.ts
│   ├── dtos/                   # Zod DTOs → OpenAPI schemas
│   │   ├── asset-file.dto.ts
│   │   ├── asset-response.dto.ts
│   │   ├── calendar-heatmap.dto.ts
│   │   └── system-metadata.dto.ts
│   ├── emails/                 # React Email templates
│   │   ├── album-invite.email.tsx
│   │   ├── welcome.email.tsx
│   │   └── components/
│   ├── maintenance/            # Maintenance-mode worker (separate boot path)
│   │   ├── maintenance-auth.guard.ts
│   │   ├── maintenance-health.repository.ts
│   │   ├── maintenance-websocket.repository.ts
│   │   ├── maintenance-worker.controller.ts
│   │   └── maintenance-worker.service.ts
│   ├── middleware/             # Guards, interceptors, filters
│   │   ├── asset-upload.interceptor.ts
│   │   ├── global-exception.filter.ts
│   │   └── logging.interceptor.ts
│   ├── queries/                # Raw SQL query files
│   │   ├── album.repository.sql
│   │   ├── stack.repository.sql
│   │   └── tag.repository.sql
│   ├── repositories/           # Technology-specific data access (Hexagonal "adapters")
│   │   ├── index.ts            # export const repositories = [...]
│   │   ├── access.repository.ts
│   │   ├── activity.repository.ts
│   │   ├── album.repository.ts
│   │   ├── album-user.repository.ts
│   │   ├── api-key.repository.ts
│   │   ├── app.repository.ts
│   │   ├── asset.repository.ts
│   │   ├── asset-edit.repository.ts
│   │   ├── asset-file.repository.ts
│   │   ├── asset-job.repository.ts
│   │   ├── config.repository.ts
│   │   ├── cron.repository.ts
│   │   ├── crypto.repository.ts
│   │   ├── database.repository.ts
│   │   ├── download.repository.ts
│   │   ├── duplicate.repository.ts
│   │   ├── email.repository.ts
│   │   ├── event.repository.ts
│   │   ├── integrity.repository.ts
│   │   ├── job.repository.ts
│   │   ├── library.repository.ts
│   │   ├── logging.repository.ts
│   │   ├── machine-learning.repository.ts
│   │   ├── map.repository.ts
│   │   ├── media.repository.ts
│   │   ├── memory.repository.ts
│   │   ├── metadata.repository.ts
│   │   ├── move.repository.ts
│   │   ├── notification.repository.ts
│   │   ├── oauth.repository.ts
│   │   ├── ocr.repository.ts
│   │   ├── partner.repository.ts
│   │   ├── person.repository.ts
│   │   ├── plugin.repository.ts
│   │   ├── process.repository.ts
│   │   ├── search.repository.ts
│   │   ├── server-info.repository.ts
│   │   ├── session.repository.ts
│   │   ├── shared-link.repository.ts
│   │   ├── shared-link-asset.repository.ts
│   │   ├── stack.repository.ts
│   │   ├── storage.repository.ts
│   │   ├── sync.repository.ts
│   │   ├── sync-checkpoint.repository.ts
│   │   ├── system-metadata.repository.ts
│   │   ├── tag.repository.ts
│   │   ├── telemetry.repository.ts
│   │   ├── trash.repository.ts
│   │   ├── user.repository.ts
│   │   ├── version-history.repository.ts
│   │   ├── video-stream.repository.ts
│   │   ├── view-repository.ts
│   │   ├── websocket.repository.ts
│   │   └── workflow.repository.ts
│   ├── schema/                 # Kysely DB schema definitions
│   │   ├── index.ts            # DB interface aggregating all tables
│   │   ├── enums.ts            # Postgres enum types
│   │   ├── functions.ts        # Postgres functions/triggers
│   │   ├── migrations/         # Timestamped migration files
│   │   │   └── <timestamp>-<Name>.ts
│   │   └── tables/             # One file per table
│   │       ├── album.table.ts
│   │       ├── asset.table.ts
│   │       ├── user.table.ts
│   │       └── ... (~60 tables)
│   ├── services/               # Business logic (Hexagonal "core")
│   │   ├── index.ts            # export const services = [...]
│   │   ├── base.service.ts
│   │   ├── activity.service.ts
│   │   ├── album.service.ts
│   │   ├── api-key.service.ts
│   │   ├── api.service.ts
│   │   ├── asset.service.ts
│   │   ├── asset-file.service.ts
│   │   ├── asset-media.service.ts
│   │   ├── auth.service.ts
│   │   ├── auth-admin.service.ts
│   │   ├── cli.service.ts
│   │   ├── database.service.ts
│   │   ├── database-backup.service.ts
│   │   ├── download.service.ts
│   │   ├── duplicate.service.ts
│   │   ├── hls.service.ts
│   │   ├── integrity.service.ts
│   │   ├── job.service.ts
│   │   ├── library.service.ts
│   │   ├── maintenance.service.ts
│   │   ├── map.service.ts
│   │   ├── media.service.ts
│   │   ├── memory.service.ts
│   │   ├── metadata.service.ts
│   │   ├── notification.service.ts
│   │   ├── notification-admin.service.ts
│   │   ├── ocr.service.ts
│   │   ├── partner.service.ts
│   │   ├── person.service.ts
│   │   ├── plugin.service.ts
│   │   ├── queue.service.ts
│   │   ├── search.service.ts
│   │   ├── server.service.ts
│   │   ├── session.service.ts
│   │   ├── shared-link.service.ts
│   │   ├── smart-info.service.ts
│   │   ├── stack.service.ts
│   │   ├── storage.service.ts
│   │   ├── storage-template.service.ts
│   │   ├── sync.service.ts
│   │   ├── system-config.service.ts
│   │   ├── system-metadata.service.ts
│   │   ├── tag.service.ts
│   │   ├── telemetry.service.ts
│   │   ├── timeline.service.ts
│   │   ├── transcoding.service.ts
│   │   ├── trash.service.ts
│   │   ├── user.service.ts
│   │   ├── user-admin.service.ts
│   │   ├── version.service.ts
│   │   ├── view.service.ts
│   │   ├── workflow.service.ts
│   │   └── workflow-execution.service.ts
│   ├── utils/                  # Pure helpers
│   │   ├── access.ts
│   │   ├── asset.util.ts
│   │   ├── bytes.ts
│   │   ├── config.ts
│   │   ├── database.ts
│   │   ├── date.ts
│   │   ├── duplicate.ts
│   │   ├── editor.ts
│   │   ├── event.ts
│   │   ├── fetch.ts
│   │   ├── file.ts
│   │   ├── logger.ts
│   │   ├── maintenance.ts
│   │   ├── media.ts
│   │   ├── mime-types.ts
│   │   ├── misc.ts
│   │   ├── object.ts
│   │   ├── pagination.ts
│   │   ├── preferences.ts
│   │   ├── profile-image.ts
│   │   ├── replace-template-tags.ts
│   │   ├── request.ts
│   │   ├── response.ts
│   │   ├── search-cursor.ts
│   │   └── search-filter.ts
│   └── workers/                # Worker entrypoints
│       ├── api.ts
│       ├── microservices.ts
│       └── maintenance.ts
├── test/
│   ├── factories/              # Test data factories
│   ├── fixtures/               # Static fixtures
│   ├── medium/                 # Integration test setup (real DB)
│   ├── repositories/           # Repository mocks
│   ├── vitest.config.mjs
│   └── vitest.config.medium.mjs
├── Dockerfile
├── Dockerfile.dev
├── eslint.config.mjs
├── helmet.json
├── mise.toml
├── nest-cli.json
├── package.json
├── .prettierrc
└── tsconfig.json
```

### 3.3 Server architecture rules (critical for the clone)

1. **Layering:** `controllers → services → repositories`. Controllers never touch the DB.
   Services contain business logic and depend only on repository interfaces.
2. **Registry pattern:** `controllers/index.ts`, `services/index.ts`, `repositories/index.ts` each
   export a flat array. [`app.module.ts`](server/src/app.module.ts:43) spreads them into the Nest module:
   ```ts
   const common = [...repositories, ...services, GlobalExceptionFilter];
   ```
3. **Three boot modes** via `ImmichWorker` enum: `Api`, `Microservices`, `Maintenance`.
   [`main.ts`](server/src/main.ts:17) manages worker lifecycle and advisory locks.
4. **DTOs are Zod schemas** (`nestjs-zod`) and are the single source of truth for OpenAPI.
5. **Global middleware** registered in `app.module.ts`:
   `ZodValidationPipe`, `ZodSerializerInterceptor`, `LoggingInterceptor`, `ErrorInterceptor`,
   `GlobalExceptionFilter`, `AuthGuard`.
6. **Config** is centralized in `ConfigRepository.getEnv()` returning `{ bull, cls, database, otel, workers }`.
7. **Migrations** are timestamped files in `src/schema/migrations/`, generated by `@immich/sql-tools`.

---

## 4. Web (`web/`) — SvelteKit Frontend

### 4.1 Package manifest (shape)

```json
{
  "name": "immich-web",
  "scripts": {
    "build": "vite build",
    "check:svelte": "svelte-check --no-tsconfig --fail-on-warnings",
    "check:typescript": "tsc --noEmit",
    "dev": "vite dev --host 0.0.0.0 --port 3000",
    "lint": "eslint . --max-warnings 0 --concurrency 6",
    "prepare": "svelte-kit sync",
    "test": "vitest"
  },
  "type": "module",
  "version": "3.2.0-rc.0"
}
```

**Key dependencies:** `@immich/sdk` (workspace), `@immich/ui`, `@immich/justified-layout-wasm`,
`svelte-i18n`, `svelte-persisted-store`, `svelte-gestures`, `socket.io-client`, `maplibre-gl`,
`svelte-maplibre`, `pmtiles`, `hls.js`, `media-chrome`, `@photo-sphere-viewer/*`, `fabric`,
`thumbhash`, `uplot`, `luxon`, `lodash-es`, `qrcode`, `tailwind-merge`, `tailwind-variants`.

### 4.2 Source tree

```
web/
├── bin/immich-web
├── src/
│   ├── app.html
│   ├── app.css
│   ├── app.d.ts
│   ├── hooks.client.ts
│   ├── hooks.server.ts
│   ├── lib/
│   │   ├── commands.ts
│   │   ├── constants.ts
│   │   ├── route.ts
│   │   ├── utils.ts
│   │   ├── __mocks__/          # Vitest mocks (sdk, observers, animate)
│   │   ├── actions/            # Svelte actions (use:focus-trap)
│   │   ├── assets/             # SVGs, placeholder images
│   │   ├── components/         # Svelte components (grouped by feature)
│   │   │   ├── Image.svelte
│   │   │   ├── AdaptiveImage.svelte
│   │   │   ├── AssetViewerEvents.svelte
│   │   │   ├── admin-settings/
│   │   │   ├── album-page/
│   │   │   ├── asset-viewer/
│   │   │   ├── server-statistics/
│   │   │   ├── sidebar/
│   │   │   ├── timeline/actions/
│   │   │   └── user-settings-page/
│   │   ├── managers/           # Stateful rune-based managers (*.svelte.ts)
│   │   │   ├── auth-manager.svelte.ts
│   │   │   ├── event-manager.svelte.ts
│   │   │   ├── upload-manager.svelte.ts
│   │   │   ├── timeline-manager/
│   │   │   └── ...
│   │   ├── services/           # API-facing services wrapping @immich/sdk
│   │   │   ├── album.service.ts
│   │   │   ├── asset.service.ts
│   │   │   └── ...
│   │   ├── stores/             # Svelte stores (*.svelte.ts for runes)
│   │   └── utils.ts
│   ├── params/                 # Route param matchers
│   │   ├── id.ts
│   │   └── photos.ts
│   ├── routes/                 # SvelteKit file-based routing
│   │   ├── +error.svelte
│   │   ├── +page.ts
│   │   ├── (user)/             # Route group: authenticated user area
│   │   │   ├── albums/
│   │   │   ├── people/
│   │   │   ├── recently-added/[[photos=photos]]/[[assetId=id]]/
│   │   │   ├── shared-links/(list)/
│   │   │   ├── sharing/
│   │   │   └── user-settings/
│   │   ├── admin/              # Admin area
│   │   │   ├── library-management/[id]/
│   │   │   ├── maintenance/
│   │   │   └── users/
│   │   └── auth/               # Login/register (implied)
│   ├── service-worker/
│   │   └── index.ts
│   └── test-data/
├── .npmrc
├── package.json
├── svelte.config.js
├── tsconfig.json
└── vite.config.ts
```

### 4.3 Web conventions

- **Svelte 5 runes** everywhere; stateful modules use the `.svelte.ts` extension.
- **Managers** (`lib/managers/`) hold long-lived reactive state; **services** (`lib/services/`) wrap SDK calls.
- **Route groups** `(user)` and `admin` separate authenticated vs admin layouts.
- **`+page.ts`** files handle data loading; **`+page.svelte`** renders.
- All API calls go through `@immich/sdk` (generated from OpenAPI), never raw `fetch`.

---

## 5. Shared Packages (`packages/`)

```
packages/
├── cli/                    # @immich/cli — command-line upload client
│   ├── bin/immich
│   ├── src/
│   │   ├── index.ts
│   │   ├── queue.ts
│   │   ├── utils.ts
│   │   └── commands/
│   │       ├── asset.ts
│   │       ├── auth.ts
│   │       └── server-info.ts
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── sdk/                    # @immich/sdk — generated OpenAPI TypeScript client
│   ├── src/
│   │   ├── fetch-client.ts # AUTO-GENERATED by oazapfts
│   │   ├── fetch-errors.ts
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
├── plugin-sdk/             # @immich/plugin-sdk — WASM plugin authoring SDK
│   ├── src/
│   │   ├── cli.ts
│   │   ├── host-functions.ts
│   │   ├── sdk.ts
│   │   └── types.ts
│   ├── esbuild.js
│   └── package.json
├── plugin-core/            # @immich/plugin-core — built-in plugin
│   ├── src/index.ts
│   ├── manifest.json
│   ├── esbuild.js
│   └── package.json
├── scripts/                # @immich/scripts — release/version automation
│   ├── src/
│   │   ├── cli.ts
│   │   ├── main.ts
│   │   └── commands/release.ts
│   └── package.json
└── e2e-auth-server/        # Mock OAuth server for e2e tests
    ├── auth-server.ts
    ├── startup.ts
    └── test-keys.ts
```

---

## 6. Docker (`docker/`)

```
docker/
├── docker-compose.yml          # Production
├── docker-compose.dev.yml      # Development (hot reload)
├── docker-compose.prod.yml     # Production overrides
├── docker-compose.rootless.yml # Rootless variant
├── example.env                 # Template env file
├── hwaccel.ml.yml              # ML hardware acceleration profiles
├── hwaccel.transcoding.yml     # Transcoding hardware acceleration
├── prometheus.yml
└── README.md
```

### `docker-compose.dev.yml` services

| Service                   | Image / Build                                                    | Ports                  | Purpose                                |
| :------------------------ | :--------------------------------------------------------------- | :--------------------- | :------------------------------------- |
| `immich-init`             | `server/Dockerfile.dev` (target `dev`)                           | —                      | Runs `mise install`, signals readiness |
| `immich-server`           | `server/Dockerfile.dev`                                          | `2283`, `9230`, `9231` | NestJS API + workers                   |
| `immich-web`              | `server/Dockerfile.dev`                                          | `3000`, `24678`        | SvelteKit dev server                   |
| `immich-machine-learning` | `machine-learning/Dockerfile`                                    | `3003`                 | FastAPI ML service                     |
| `redis`                   | `valkey/valkey:9`                                                | —                      | BullMQ queue backend                   |
| `database`                | `ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0` | `5432`                 | Postgres with vector extensions        |

**Base service pattern:** `immich-app-base` (profile `_base`) defines shared volumes including
per-package `node_modules` volumes and `build_cache`. Other services `extends` it.

---

## 7. Other Workspace Packages

```
docs/           # Docusaurus site (docs/docs/developer/*.md, docs/docs/features/*.md)
e2e/            # Playwright tests (src/fixtures.ts, src/generators.ts, playwright.config.ts)
i18n/           # en.json + ~100 locale JSON files
machine-learning/  # Python FastAPI (immich_ml/ package)
mobile/         # Flutter app (lib/, packages/ui/, ios/, android/)
open-api/       # immich-openapi-specs.json + generation templates
.github/        # CI workflows (a workspace package with its own node_modules)
```

---

## 8. Conventions Summary (agent checklist)

- [ ] **Monorepo:** pnpm workspaces + mise monorepo tasks (`mise //server:lint`).
- [ ] **Server layering:** controllers → services → repositories; registries as arrays in `index.ts`.
- [ ] **DTOs:** Zod schemas via `nestjs-zod`; they generate the OpenAPI spec.
- [ ] **DB:** Kysely + `@immich/sql-tools`; schema in `src/schema/tables/*.table.ts`; timestamped migrations.
- [ ] **Workers:** three modes (api, microservices, maintenance) selected by `ImmichWorker` enum.
- [ ] **Jobs:** BullMQ queues registered in `app.module.ts` via `BullModule.registerQueue(...bull.queues)`.
- [ ] **Web:** SvelteKit + Svelte 5 runes; `.svelte.ts` for stateful modules; SDK-only API access.
- [ ] **Naming:** kebab-case files, `.controller.ts` / `.service.ts` / `.repository.ts` / `.table.ts` suffixes.
- [ ] **Tests:** co-located `*.spec.ts` for units; `test/medium/` for DB integration; `e2e/` for Playwright.
- [ ] **Formatting:** Prettier (2-space, single quotes) + ESLint with `--max-warnings 0`.
- [ ] **Node:** 24.15.0; **pnpm:** 11.22.0.

---

## 9. Suggested Scaffold Order for a Clone

1. Root workspace: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `mise.toml`, `.prettierrc`, `.editorconfig`.
2. `docker/`: `docker-compose.dev.yml` + `example.env` (server, web, postgres, redis).
3. `server/`: NestJS skeleton → `main.ts`, `app.module.ts`, `repositories/index.ts`, `services/index.ts`,
   `controllers/index.ts`, one working endpoint (`GET /api/server-info`), Kysely config, empty `schema/`.
4. `packages/sdk/`: minimal generated-client placeholder.
5. `web/`: SvelteKit skeleton → one route calling the server via the SDK.
6. `packages/cli/`: minimal CLI hitting `/api/server-info`.
7. Tooling: `eslint.config.mjs`, `tsconfig.json`, `vitest.config.mjs` per package.
8. Verify: `mise dev` boots all services; lint + tests pass with zero warnings.
