# immich-clone

A small, production-quality monorepo that implements one complete CRUD feature
(`photos`) across a SvelteKit → NestJS → Postgres stack, arranged to mirror
Immich's directory layout at a fraction of the size.

The architecture is deliberately tiny. The goal is to understand the stack and
to leave a clean seam for growth, not to reproduce Immich.

```text
Web (SvelteKit + Svelte 5 runes)      CLI (packages/cli)
   │                                       │
   └──────────────► @immich/sdk ◄──────────┘
                        │  HTTP  (/api/...)
                        ▼
                 Server (NestJS)
                        │  SQL   (Kysely query builder)
                        ▼
                 Database (PostgreSQL)
```

Both clients speak to the API through the same shared SDK, so there is exactly
one place that knows how to call the backend.

## Project structure

```text
.
├── packages/
│   ├── sdk/                          Typed API client, shared by web and CLI
│   │   └── src/
│   │       ├── fetch-client.ts       fetch wrapper, base URL, ApiError
│   │       ├── photos.ts             Photo endpoints
│   │       ├── server-info.ts        Reachability endpoint
│   │       ├── types.ts              Photo, ServerInfo
│   │       └── index.ts              The package's public surface
│   └── cli/                          Command-line client
│       └── src/
│           ├── commands/             One file per command group (photos, server-info)
│           ├── utils/config.ts       --url / IMMICH_INSTANCE_URL resolution
│           └── index.ts              Commander program
├── server/                           NestJS API
│   └── src/
│       ├── bin/migrate.ts            Migration runner: up / down / reset
│       ├── controllers/              HTTP routing only, plus the registry
│       ├── services/                 Business rules + error semantics, plus the registry
│       ├── repositories/             The only place that writes SQL, plus the registry
│       ├── schema/
│       │   ├── tables/               Kysely table interfaces (*.table.ts)
│       │   └── migrations/           Hand-written SQL migrations + registry
│       ├── dtos/                     Request validation (class-validator)
│       ├── middleware/               Global exception filter
│       ├── utils/                    config + database helpers
│       ├── validation.ts             zod-validated environment config
│       ├── constants.ts
│       ├── database.ts               Kysely/pg client factory
│       ├── app.module.ts             Spreads the registries into Nest
│       └── main.ts                   Bootstrap, global prefix, CORS, ValidationPipe
├── web/                              SvelteKit 2 + Svelte 5 (runes)
│   └── src/
│       ├── lib/
│       │   ├── components/           Presentational .svelte components
│       │   ├── services/             Thin wrappers over @immich/sdk
│       │   ├── stores/               Rune-backed ($state) containers
│       │   ├── managers/             Orchestration: services + stores + error handling
│       │   ├── constants.ts
│       │   └── utils.ts
│       ├── routes/                   File-based routes
│       │   ├── +layout.ts            `ssr = false`
│       │   ├── +layout.svelte
│       │   ├── +page.ts              Client-side data load
│       │   ├── +page.svelte
│       │   └── +error.svelte
│       ├── app.html / app.css / app.d.ts
├── docker/
│   ├── docker-compose.dev.yml         web + server + database
│   ├── server.Dockerfile
│   └── web.Dockerfile
├── mise.toml                          Toolchain + task definitions
├── pnpm-workspace.yaml
└── package.json
```

The suffix conventions (`*.controller.ts`, `*.service.ts`, `*.repository.ts`,
`*.table.ts`, `*.svelte.ts`) are the reference project's, and they are what make
a file's role readable from its name alone.

## Quick start

Prerequisites: Node ≥ 22, pnpm ≥ 9, Docker.

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Start Postgres
#    (skip this if a Postgres already answers on :5432 — see the note below)
docker compose -f docker/docker-compose.dev.yml up -d database

# 3. Create the schema
pnpm migrations:run

# 4. Run both apps (server on :2283, web on :3000)
pnpm dev
```

Open <http://localhost:3000>.

If something else already owns `:2283` (a real Immich instance, for example),
run the API on another port and point the dev server at it:

```bash
PORT=2284 pnpm dev:server
VITE_API_PROXY=http://localhost:2284 pnpm dev:web
```

`:5432` deserves the same check. If a Postgres already listens there — an
Immich install, or a database started from another checkout — step 2 fails with
`bind: address already in use`, and the container is left in `Created` state.
Find out whether that Postgres is already the one you want:

```bash
curl -s localhost:2283/api/health       # {"status":"ok","database":"up"} -> it is serving
```

If it already holds this project's schema (`public.photos` and
`public.schema_migrations`), skip step 2 entirely — `pnpm migrations:run` and
`pnpm dev` will use it, and the `docker compose` database service is redundant.
To run a _separate_ database container anyway, publish it on a free host port
and point the host-run API at that port (only the host side moves):

```bash
DB_HOST_PORT=5433 docker compose -f docker/docker-compose.dev.yml up -d database
DB_PORT=5433 PORT=2284 pnpm dev:server
```

A container wedged in `Created` by a failed bind is cleaned up with
`docker compose -f docker/docker-compose.dev.yml down --remove-orphans`; the
`postgres_data` volume survives, so no data is lost.

### Running the whole stack in Docker

```bash
cd docker
cp .env.example .env      # optional overrides
docker compose -f docker-compose.dev.yml up --build
```

The compose file runs `pnpm --filter server run migrations:run` before the API
starts, so the schema is always current.

Published host ports are overridable so the stack can coexist with an existing
Immich install: `DB_HOST_PORT`, `SERVER_HOST_PORT` and `WEB_HOST_PORT`, all
optional and documented in [`docker/.env.example`](docker/.env.example:8). Set
them in `docker/.env`, or inline for a one-off:

```bash
DB_HOST_PORT=5433 SERVER_HOST_PORT=2285 WEB_HOST_PORT=3001 \
  docker compose -f docker-compose.dev.yml up
```

#### When `up` fails with `bind: address already in use`

The defaults assume nothing else listens on `5432`, `2283` or `3000`. A machine
that also runs the host dev stack beside a real Immich install breaks that
assumption, and the failure reads as though a stranger owned the port. Usually
it is this project, one daemon over.

Compose talks only to the daemon the active context names, so `docker ps` can be
empty while the port stays taken:

```bash
docker context show                  # the daemon `docker compose` will use
docker --context default ps          # what the other daemon is running
```

If that second listing shows an `immich_clone_postgres` publishing
`0.0.0.0:5432->5432`, it is the `database` service of this same compose file,
started earlier against the system daemon. It owns host port 5432, so an `up`
through Docker Desktop cannot bind it. Each daemon keeps its own volumes, so the
two containers share a name and nothing else.

Two ways out:

- **Use the database that already exists.** It carries `public.photos` and
  `public.schema_migrations`, so the host stack needs no container at all:
  `pnpm migrations:run && pnpm dev`. Shortest path when the containerized stack
  is not what is actually wanted.
- **Run the containerized stack beside it**, with every published port moved.
  Put the free ports in `docker/.env` so the choice sticks:

  ```bash
  # docker/.env — verify first: ss -lnt | grep -E ':(5433|2285|3001)\b'
  DB_HOST_PORT=5433
  SERVER_HOST_PORT=2285
  WEB_HOST_PORT=3001
  ```

  `2285` and `3001` rather than `2284` and `3000`, because the host-run API and
  Vite dev server already hold those. Nothing changes inside the compose
  network: the server still reaches Postgres as `database:5432`, so only the host
  side of each mapping moves.

Keeping the project on a single daemon is the durable fix; the port overrides
exist so a second daemon remains possible, not so it becomes the norm.

### Useful scripts

| Command                      | What it does                                         |
| ---------------------------- | ---------------------------------------------------- |
| `pnpm dev`                   | Runs server and web in parallel                      |
| `pnpm dev:server`            | Runs the API only                                    |
| `pnpm dev:web`               | Runs the web app only                                |
| `pnpm build`                 | Builds every package (Nest + SvelteKit/adapter-node) |
| `pnpm check`                 | Typechecks every package                             |
| `pnpm lint`                  | Lints every package                                  |
| `pnpm format` / `format:fix` | Verifies / rewrites formatting                       |
| `pnpm migrations:run`        | Applies pending migrations                           |
| `pnpm migrations:rollback`   | Reverts the most recent migration                    |
| `pnpm schema:reset`          | Drops all tables, then migrates from scratch         |
| `pnpm cli <command>`         | Runs the CLI, e.g. `pnpm cli server-info`            |

Every task is mirrored in [`mise.toml`](mise.toml:15), so `mise run dev`,
`mise run check` and `mise run cli -- server-info` behave identically.

## API

Base URL: `http://localhost:2283/api`

| Method   | Path           | Success                                | Errors                                       |
| -------- | -------------- | -------------------------------------- | -------------------------------------------- |
| `POST`   | `/photos`      | `201` + photo                          | `400` invalid body                           |
| `GET`    | `/photos`      | `200` + array                          | —                                            |
| `GET`    | `/photos/:id`  | `200` + photo                          | `400` bad uuid, `404` not found              |
| `PATCH`  | `/photos/:id`  | `200` + photo                          | `400` bad uuid / empty body, `404` not found |
| `DELETE` | `/photos/:id`  | `204` no body                          | `400` bad uuid, `404` not found              |
| `GET`    | `/server-info` | `200` + `{name, version, nodeVersion}` | —                                            |
| `GET`    | `/health`      | `200` + `{status, database}`           | —                                            |

```bash
curl -X POST http://localhost:2283/api/photos \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sunset over the bay"}'
```

The CLI reads the same endpoints:

```bash
pnpm cli photos list --url http://localhost:2283/api
pnpm cli photos create "Sunset over the bay" --url http://localhost:2283/api
pnpm cli server-info --url http://localhost:2283/api
```

`--url` falls back to `IMMICH_INSTANCE_URL`, then to `http://localhost:2283/api`
(see [`resolveApiUrl`](packages/cli/src/utils/config.ts:17)).

## How a `POST /photos` request flows

1. **Component.** [`photo-form.svelte`](web/src/lib/components/photo-form.svelte:18)
   trims the input, refuses empty names, and calls the `onSubmit` prop. No HTTP
   knowledge lives in the component.
2. **Page.** [`+page.svelte`](web/src/routes/+page.svelte:10) passes
   `(name) => photoManager.create(name)` as that prop — the page wires UI to a
   manager and nothing else.
3. **Manager.** [`PhotoManager.create`](web/src/lib/managers/photo-manager.svelte.ts:41)
   flips the loading flag, calls the service, then prepends the result to the
   store. It swallows failures into `store.error` so components never see a
   rejected promise.
4. **Service.** [`addPhoto`](web/src/lib/services/photos.service.ts:13) is a
   one-line wrapper around the SDK. Managers depend on this folder, never on
   `@immich/sdk` directly, so the transport can be swapped in one place.
5. **SDK.** [`createPhoto`](packages/sdk/src/photos.ts:12) builds the request and
   [`request`](packages/sdk/src/fetch-client.ts:31) resolves the base URL,
   serialises the body, and throws an [`ApiError`](packages/sdk/src/fetch-client.ts:20)
   for any non-2xx response — including Nest's `{message: [...]}` envelopes.
6. **Transport.** The URL is relative (`/api/photos`), so the browser hits the
   SvelteKit dev server, which proxies `/api` to Nest
   ([`vite.config.ts`](web/vite.config.ts:17)). One origin in dev, no CORS
   preflight.
7. **Validation.** Nest's global `ValidationPipe`
   ([`main.ts`](server/src/main.ts:20)) validates the body against
   [`CreatePhotoDto`](server/src/dtos/photo.dto.ts:12). Unknown fields are
   rejected with `400`.
8. **Controller.** [`PhotoController.create`](server/src/controllers/photo.controller.ts:38)
   does nothing but delegate. Nest returns `201` automatically.
9. **Service.** [`PhotoService.create`](server/src/services/photo.service.ts:19)
   trims the name and hands a plain object to the repository.
10. **Repository.** [`PhotoRepository.create`](server/src/repositories/photo.repository.ts:16)
    builds `INSERT INTO photos (name) VALUES ($1) RETURNING *` via Kysely, using
    the single pooled client owned by
    [`DatabaseRepository`](server/src/repositories/database.repository.ts:20).
    This is the only file that knows SQL.
11. **Database.** Postgres fills `id` (`gen_random_uuid()`) and the timestamps
    from column defaults, and returns the row.
12. **Response.** The row travels back up unchanged and is serialised as JSON.
    The manager hands it to
    [`PhotosStore.prepend`](web/src/lib/stores/photos.store.svelte.ts:19), and
    because the store's fields are `$state`, every component reading them
    re-renders.

## Why the workspace exists

`server`, `web`, `packages/sdk` and `packages/cli` are separate packages that
share one lockfile, one `node_modules` layout and one set of root scripts. That
gives:

- **One install.** `pnpm install` at the root resolves everything.
- **A real shared package.** `packages/sdk` is exported as raw TypeScript and
  consumed directly by Vite and `tsx`, so a change to an endpoint's shape breaks
  the build in the very same command that introduced it.
- **Explicit boundaries.** `web` and `cli` can only reach the server through the
  SDK; neither declares `server` as a dependency, so a stray import fails loudly.
- **A place for the next shared thing.** Adding `packages/shared` is one line in
  [`pnpm-workspace.yaml`](pnpm-workspace.yaml:1).

## Major dependencies and why each exists

### Server

| Dependency                                                   | Why                                                                                                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | The framework, per the reference.                                                                                                               |
| `@nestjs/config`                                             | Loads env vars and runs our zod validator at boot.                                                                                              |
| `kysely`                                                     | Type-safe SQL builder. Matches the reference stack; no ORM magic, so the generated SQL stays obvious.                                           |
| `pg`                                                         | Postgres driver. Kysely's `PostgresDialect` is built around `pg.Pool`, so this avoids the extra `kysely-postgres-js` bridge the reference uses. |
| `class-validator`, `class-transformer`                       | Declarative DTO validation, wired into Nest's `ValidationPipe`.                                                                                 |
| `zod`                                                        | Validates _environment_ config at startup. Used here rather than for HTTP bodies because there is no Nest pipe involved at boot time.           |
| `reflect-metadata`                                           | Required by Nest's decorator metadata.                                                                                                          |
| `rxjs`                                                       | A required peer of Nest even when unused directly.                                                                                              |

### Web

| Dependency                                       | Why                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `svelte`, `@sveltejs/kit`                        | The framework and file-based routing, per the reference web app.                        |
| `@sveltejs/vite-plugin-svelte`, `vite`           | Dev server with HMR, and the production build.                                          |
| `@sveltejs/adapter-node`                         | Builds a plain Node server instead of a platform-specific bundle, so Docker stays dumb. |
| `svelte-check`                                   | Typechecks `.svelte` files, which `tsc` cannot.                                         |
| `eslint-plugin-svelte`, `prettier-plugin-svelte` | Lints and formats Svelte syntax rather than treating it as opaque text.                 |
| `@immich/sdk`                                    | The workspace package — the app's only way of reaching the API.                         |

### Shared packages

`packages/sdk` has **no runtime dependencies**: `fetch`, `URL` and `Error` are
built in, and the types are local. `packages/cli` depends on `commander` for
argument parsing and on `@immich/sdk` for the calls. Anything not listed was
left out on purpose — plain CSS does the job, so there is no component library;
the managers are a few dozen lines, so there is no data-fetching library.

## Intentional omissions from the reference

The reference files describe a large production application. Almost all of that
is Immich-specific complexity that this CRUD app does not need yet.

| Omitted                                                                     | Why                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication / authorization**                                          | No users in the model. Adding auth without a user concept would be ceremony.                                                                                              |
| **Redis / BullMQ / workers**                                                | Every request here is a short synchronous query. A queue would add a moving part with nothing to move.                                                                    |
| **WebSockets / Socket.IO**                                                  | Nothing pushes server-initiated updates.                                                                                                                                  |
| **OpenTelemetry / Prometheus / Grafana**                                    | Observability is valuable, but a single-process app can be understood from logs. These belong in a later step with a real deployment target.                              |
| **Object storage / image processing (`sharp`, `exiftool`, `ffmpeg`)**       | The `Photo` model stores a _name_, not a file. There is nothing to process or store.                                                                                      |
| **React Email / `@react-email/*`**                                          | No account flows, so no email to send.                                                                                                                                    |
| **`@immich/sql-tools`**                                                     | Proprietary Immich tooling. Replaced by a ~100-line migration runner with the same SQL-first philosophy.                                                                  |
| **`@immich/ui`, `@immich/plugin-sdk`**                                      | Immich-internal packages; unavailable and unnecessary. `@immich/sdk` itself is reimplemented locally in `packages/sdk`.                                                   |
| **Tailwind / `@immich/ui` theming**                                         | One feature needs a handful of rules; [`app.css`](web/src/app.css:1) plus component-scoped `<style>` blocks is less machinery.                                            |
| **VectorChord / pgvector Postgres image**                                   | Used for embedding search. We have no embeddings, so plain `postgres:16-alpine` is correct.                                                                               |
| **Machine-learning container**                                              | No inference in the request path.                                                                                                                                         |
| **`helmet`, `compression`, `cookie-parser`, `@nestjs/swagger`**             | Real hardening/documentation concerns, but each is a deliberate addition to make _after_ the core flow is understood. Adding all of them now would obscure the CRUD path. |
| **`lodash`, `luxon`, `uuid`, `validator`**                                  | Native `Date` and crypto-backed `gen_random_uuid()` cover current needs. `class-validator` handles input checks.                                                          |
| **`allowBuilds` entries for `bcrypt`, `canvas`, `ssh2`, etc.**              | Those native modules are not installed, so opting their build scripts in would be dead configuration. Only `esbuild` (needed by Vite) is listed.                          |
| **`packageExtensions`, `dedupePeerDependents`, `minimumReleaseAgeExclude`** | Workarounds for specific third-party packages in the reference. None of those packages are present here.                                                                  |
| **Init container, named node_modules volumes per package**                  | The reference needs these for a large multi-language monorepo. Four packages and one Dockerfile each do not.                                                              |

What _was_ kept from the reference: the overall four-layer shape, the
controllers → services → repositories split with registry arrays instead of a
module per feature, NestJS with Kysely and `pg`, a SQL-first migration story,
zod for config validation, `class-validator` for request validation, a shared
SDK consumed by both the web app and the CLI, mise as the toolchain entry point,
and the `docker/` development-compose convention.

## Design decisions worth knowing

Each of these is also documented at the point of use:

- **Repository layer.** [`PhotoRepository`](server/src/repositories/photo.repository.ts:13)
  is the only feature file containing SQL. It costs one small class and buys a
  test seam plus the ability to change the storage approach without touching
  business rules.
- **One database client.** [`DatabaseRepository`](server/src/repositories/database.repository.ts:19)
  owns the single Kysely/pg pool and closes it in `onApplicationShutdown`. Feature
  repositories receive it by injection, so there is exactly one pool and one
  shutdown path.
- **Registries instead of feature modules.** [`controllers`](server/src/controllers/index.ts:12),
  `services` and `repositories` are plain arrays spread into
  [`app.module.ts`](server/src/app.module.ts:20). A new feature is three lines of
  wiring, and there is no `PhotosModule` to keep in sync.
- **Service owns HTTP errors.** [`PhotoService`](server/src/services/photo.service.ts:14)
  extends `BaseService` and throws `NotFoundException`/`BadRequestException`
  directly. Correct for one transport; a second transport would justify
  introducing domain error types and mapping them in a filter.
- **Thin controller.** [`PhotoController`](server/src/controllers/photo.controller.ts:25)
  never contains logic, which is what makes the service testable without a
  server.
- **Strict DTOs.** [Whitelisting](server/src/main.ts:24) strips unknown
  properties _and_ rejects them, so a client typo surfaces as a `400` instead of
  a silent no-op.
- **`PATCH` rejects empty bodies.** [`PhotoService.update`](server/src/services/photo.service.ts:34)
  returns `400` rather than silently bumping `updatedAt` on a no-op.
- **Web layering.** Components render, [services](web/src/lib/services/photos.service.ts:9)
  translate, [stores](web/src/lib/stores/photos.store.svelte.ts:10) hold state,
  and [managers](web/src/lib/managers/photo-manager.svelte.ts:12) decide. A
  component never imports the SDK, and a store never performs I/O.
- **Managers never throw.** They convert failures into a message on the store, so
  the page renders an alert instead of the error boundary and a failed refresh
  does not discard the photos already on screen.
- **`ssr = false`.** [`+layout.ts`](web/src/routes/+layout.ts:1) keeps the app
  client-rendered. There is no SEO story for a photo list behind a login, and it
  means there is exactly one code path for loading data.
- **Relative API URLs.** The SDK defaults to `/api`, which the SvelteKit dev
  proxy forwards and a reverse proxy will forward in production. No
  environment-specific base URL in the browser bundle.

## Schema

```sql
CREATE TABLE photos (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX photos_created_at_idx ON photos ("createdAt");
```

The index backs the `ORDER BY "createdAt" DESC` used by `GET /photos`. The table
interface lives in
[`photo.table.ts`](server/src/schema/tables/photo.table.ts:1) and the migration in
[`1789862400000-CreatePhotos.ts`](server/src/schema/migrations/1789862400000-CreatePhotos.ts:12).

To add a migration: create
`server/src/schema/migrations/<timestamp>-<Name>.ts`, register it in the
[migrations array](server/src/schema/migrations/index.ts:1), then run
`pnpm migrations:run`. The runner
([`migrate.ts`](server/src/bin/migrate.ts:36)) records applied migrations in
`schema_migrations` and rolls back in reverse order — never edit an applied
migration.

