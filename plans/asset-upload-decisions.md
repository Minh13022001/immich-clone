# Asset Upload — Reimplementation: Decisions & Plan

Status: **implemented and verified** — all §13 items traced below (§5), divergences recorded (§6).
Source of truth: [`asset-upload-reimplementation-brief.md`](../asset-upload-reimplementation-brief.md).

## Decisions locked

- **D1** A — `x-user-id` header + seeded default user (`AuthService.resolve`).
- **D2** A — `Permission` enum; a resolved user satisfies `asset.upload`.
- **D3** **SKIP** — shared links not implemented; `auth.sharedLink` is always `null`.
- **D4** **SKIP** — no albums; `addAssetsToAlbums` is an unused no-op seam.
- **D5** A — in-process async job queue (fire-and-forget, typed payloads, `source`).
- **D6** A — Nest `@Sse` `GET /api/events`, per-user subscriber set.
- **D7** A — `hash-wasm` + `@noble/hashes`, 5 MiB slices, in a web worker.
- **D8** A — `checksum bytea` + `ASSET_CHECKSUM_CONSTRAINT`; detect pg `23505` + constraint name.
- **D9** A — `users.quotaSizeInBytes` (nullable) + `quotaUsageInBytes` (default 0).
- **D10** A — validated `MEDIA_ROOT` env (dev `./data`, container `/data`).
- **D11** A — class-validator multipart `CreateAssetDto` with `@Transform` coercion.
- **D12** A — Vitest in `server` + `web`; supertest + SSE-reader e2e.
- **D13** XHR upload layer (`uploadRequest`) with progress + abort.
- **D14** A — per-user SSE addressing; web dedupes by asset id.

Recorded divergences: realtime is SSE (not websocket); the job queue is in-process (not BullMQ);
shared links and albums are out of scope by explicit decision, so §9.9 is intentionally not implemented.

---

## 0. Stack delta (why mechanics must be adapted)

| Concern   | Reference (brief)         | This repo                        | Consequence                                    |
| --------- | ------------------------- | -------------------------------- | ---------------------------------------------- |
| Server    | NestJS + PostgreSQL       | NestJS 11 + Kysely/pg            | Keep behavior; SQL via Kysely                  |
| Job queue | BullMQ                    | none                             | Build an in-process queue abstraction          |
| Realtime  | websocket                 | none                             | Need an adapted push channel (SSE recommended) |
| Auth      | `auth.user`, `sharedLink` | none                             | Need a request-identity shim (biggest fork)    |
| DTO       | Zod + OpenAPI             | class-validator + zod (env only) | Multipart DTOs need coercion                   |
| Tests     | Jest + e2e                | none                             | Need to add a runner                           |
| Client    | SvelteKit runes           | SvelteKit 2 + Svelte 5 runes     | Direct match                                   |
| SDK       | generated `@immich/sdk`   | hand-written fetch SDK           | Add upload endpoints                           |

---

## 1. Behavioral summaries (spec-pinned, must not change)

### 1.1 `uploadAsset` sequence (§6)

1. `requireAccess(permission=AssetUpload, ids=[userId])`.
2. `requireQuota(auth, file.size)` → `BadRequestException('Quota has been exceeded!')` when
   `quotaSizeInBytes !== null && quotaSizeInBytes < quotaUsageInBytes + size`, **before** persistence.
3. If `dto.livePhotoVideoId`: `onBeforeLink({ userId, livePhotoVideoId })`.
4. `asset = assetRepository.create({...§3.4})`.
5. If `dto.metadata`: `upsertMetadata(asset.id, metadata)`.
6. If `sidecarFile`: `upsertFile({assetId, path, type: Sidecar})`, then `utimes(sidecarFile.path, now, dto.fileModifiedAt)`.
7. `utimes(file.path, now, dto.fileModifiedAt)` (mtime from client, not wall clock).
8. `upsertExif({assetId, fileSizeInByte: file.size}, lockedPropertiesBehavior='override')`.
9. `queue(AssetExtractMetadata, { id, source: 'upload' })` — fire-and-forget.
10. If `auth.sharedLink`: `addToSharedLink(sharedLink, asset.id)`.
11. `emit('AssetCreate', { asset, file })`.
12. Return `{ id, status: CREATED }` → HTTP 201.

Catch block (exact order):

1. `queue(FileDelete, { files: [file.originalPath, sidecarFile?.originalPath] })`.
2. If Postgres unique violation on `(ownerId, checksum)` (constraint `ASSET_CHECKSUM_CONSTRAINT`):
   resolve `duplicateId`; if missing → `InternalServerErrorException()`; attach to shared link if any;
   return `{ status: DUPLICATE, id }` → HTTP 200.
3. Else if a row was created → `assetRepository.remove({ id })`.
4. Log error + stack; rethrow.

Invariants: byte-identical same-user re-upload ⇒ `duplicate` with original id (never an error);
failure leaves no partial files and no created row; mtime comes from `fileModifiedAt`.

### 1.2 Client upload state machine (§8.4)

States: `PENDING → STARTED → { DONE | ERROR | DUPLICATED }`.

- Item: `{ id, file, albumId?, assetId?, isTrashed?, progress?, state?, startDate?, eta?, speed?, error?, message? }`.
- Derived: `isUploading` (any items), `remainingUploads` (PENDING+STARTED count), `isDismissible` (any ERROR/DUPLICATED).
- Counters: `total`, `success`, `errors`, `duplicates`.
- API: `addItem` (dedupe by id, `total++`), `markStarted`, `updateProgress(loaded,total)`
  (`speed = loaded/elapsed`, `progress = floor(loaded/total*100)`, `eta = (total-loaded)/speed`),
  `updateItem`, `removeItem` (adjust stats; refuse PENDING/STARTED), `dismissErrors`, `track`, `reset`.

---

## 2. Open decisions (need your answers)

### D1 — Request identity / `auth.user.id`

- Need: a stable `userId` per request; `auth.sharedLink` nullable.
- Options:
  - **A (rec)** `AuthService.resolve(req)` reads `x-user-id` header; if absent, falls back to a seeded
    default user (auto-provisioned at boot if the table is empty). 401 when the id is unknown.
  - **B** Always use a single default user; no header. Simpler, but loses per-user duplicate semantics.
  - **C** Real auth (session/JWT + login UI). Large; beyond the brief's scope.
- Impact: A exercises the `(ownerId, checksum)` per-user constraint and lets the web target any user.

### D2 — Permission model

- Options:
  - **A (rec)** `Permission` enum + `requireUploadAccess(auth)` that only requires a resolved user
    (no roles table). Permission name exists in code so the contract is visible.
  - **B** Add a `permissions` column/table and actually check `asset.upload`.
  - **C** No permission concept; identity is enough.
- Impact: low either way; B adds schema and is not required by any acceptance item.

### D3 — Shared links — DECIDED: SKIP (not implemented)

- Options:
  - **A (rec if minimal)** Structural only: `auth.sharedLink` is always `null`; `addToSharedLink` and a
    `SharedLinkRepository` interface exist but are never invoked. Document the divergence.
  - **B** Minimal reachable: `shared_link` table with `token`, `allowUpload`, nullable `albumId`;
    resolve from `?sharedLink=` or `x-shared-link`; `allowUpload=false` ⇒ 401. Enables §9.9 testing.
  - **C** Full: tokens + albums + `AlbumUpdate` broadcast.
- Impact: A cannot satisfy §9.9/§13 fully; B satisfies reachability with modest scope; C is largest.

### D4 — Albums — DECIDED: SKIP (no-op seam only)

- Options:
  - **A (rec)** Skip; `addAssetsToAlbums` is a no-op seam.
  - **B** Minimal `album` + `album_asset` tables so the shared-link album path is real.
- Impact: only matters if D3 = B/C.

### D5 — Job queue

- Options:
  - **A (rec)** In-process async queue: named jobs, typed payloads, `source` field, `queue()` returns
    immediately; handlers run on `setImmediate`. Failures are logged, never touch the upload response.
  - **B** Real BullMQ + Redis (new infra to run).
  - **C** DB-backed jobs table + poller.
- Impact: A matches "decoupled from the upload response" with zero infra.

### D6 — Event channel (websocket replacement)

- Options:
  - **A (rec)** Nest `@Sse` endpoint `GET /api/events`; server pushes `on_upload_success` and
    `AssetUploadReadyV2` addressed by user. One-directional, exactly what §7/§8.6 need.
  - **B** `@nestjs/websockets` + socket.io (bidirectional, heavier).
  - **C** Long-polling.
- Impact: A uses only built-ins; event names/payloads stay identical.

### D7 — SHA-1 hashing (client)

- Options:
  - **A (rec)** Add `hash-wasm` (WASM, primary) + `@noble/hashes` (pure-JS fallback), 5 MiB slices,
    in a web worker — matches §8.2 verbatim.
  - **B** Add only `@noble/hashes` (drop the WASM tier).
  - **C** Hand-rolled incremental SHA-1 (no deps) + a unit test against known vectors.
  - **D** Web Crypto `crypto.subtle.digest` per file (rejected: buffers the whole file).
- Impact: A/B add runtime deps; C is dependency-free but more code to own.

### D8 — Checksum storage + constraint

- Options:
  - **A (rec)** `checksum bytea`, `checksumAlgorithm text (sha1File)`, unique constraint
    `ASSET_CHECKSUM_CONSTRAINT` on `(ownerId, checksum)`; detect via pg code `23505` **and** constraint name.
  - **B** `checksum text` (hex), same constraint.
- Impact: A matches Immich; `fromChecksum` decode rule (base64 when decoded length is 28, else hex) lives in a util.

### D9 — Quota source

- Options:
  - **A (rec)** Add `quotaSizeInBytes` (nullable) and `quotaUsageInBytes` (default 0) to `users`;
    increment usage on success, decrement/skip on rollback and duplicate.
  - **B** Compute usage live via `SUM(exif.fileSizeInByte)` per user (no drift, slower).
- Impact: A matches the spec's field names; needs careful duplicate/rollback accounting.

### D10 — Media root

- Options:
  - **A (rec)** New `MEDIA_ROOT` env (validated in [`validation.ts`](../server/src/validation.ts:11));
    dev default `./data` (gitignored), container default `/data`.
- Impact: needed for §5.5 layout; small change to env schema + docker compose.

### D11 — Multipart DTO / validation

- Options:
  - **A (rec)** A class-validator `CreateAssetDto` with `@Transform` coercion for multipart string fields,
    plus a `FileNotEmptyValidator` custom decorator and a `ParseUUIDPipe` on `livePhotoVideoId` where applicable.
  - **B** Manual parsing/coercion inside the controller.
- Impact: A keeps the repo's "validation on the DTO" convention.

### D12 — Test runner & scope (§10)

- Options:
  - **A (rec)** Vitest for `server` and `web` (unit + service-level). Add `test` scripts.
    E2E (upload → SSE delivery → duplicate → quota) via `supertest` + an SSE reader script.
  - **B** Node built-in `node:test` run through `tsx` (no new runner dep), JSON-Schema-less.
  - **C** Jest (Nest default).
- Impact: A is fastest to wire across both apps; the spec's §10 list maps cleanly to Vitest.

### D13 — Upload transport (client)

- **A (rec)** XHR per §8.1 (progress + abort), registered for `cancelUploadRequests()` on logout.
  `fetch` cannot report upload progress, so this is effectively fixed.

### D14 — SSE addressing / multi-tab

- Options:
  - **A (rec)** `GET /api/events` resolves identity like D1; server keeps a per-user subscriber set.
  - Note: duplicate events across tabs are expected; the web dedupes by asset id (§8.6).

---

## 3. Proposed file map (subject to decisions)

Server (`server/src/`):

- `schema/tables/asset.table.ts`, `asset-file.table.ts`, `exif.table.ts`, `asset-metadata.table.ts`
- `schema/migrations/<ts>-CreateAssetTables.ts` (+ quota columns migration if D9=A)
- `schema/index.ts` (register tables + row types)
- `dtos/asset.dto.ts` (create DTO, bulk-check DTO, response DTOs, enums)
- `utils/storage.ts` (`StorageCore.getNestedFolder`), `utils/checksum.ts` (`toChecksum`/`fromChecksum`), `utils/media-types.ts`
- `repositories/asset.repository.ts`, `asset-file.repository.ts`, `exif.repository.ts`, `job.repository.ts`
- `services/asset-media.service.ts`, `job.service.ts`, `event.service.ts`
- `middleware/file-upload.interceptor.ts`, `middleware/asset-upload.interceptor.ts`
- `controllers/asset.controller.ts` (+ registry)
- `bin/` seed/default-user helper if D1=A

Web (`web/src/`):

- `lib/services/upload.service.ts`, `lib/services/events.service.ts`
- `lib/managers/upload-manager.svelte.ts`
- `lib/stores/upload.store.svelte.ts`
- `lib/utils/file-uploader.ts` (orchestrator + `ExecutorQueue`), `lib/utils/hash-file.ts`, `lib/utils/upload-request.ts`
- `lib/workers/hash-file.worker.ts`
- `lib/components/upload-panel.svelte`, `upload-preview-row.svelte`, `drag-drop-overlay.svelte`
- `routes/upload/+page.svelte` (wire the scaffold), route `+page.ts` if needed

SDK (`packages/sdk/src/`):

- `assets.ts` (`bulkUploadCheck`, `getSupportedMediaTypes`), `types.ts` (asset DTOs), `index.ts` exports

Tests:

- `server/src/**/*.spec.ts`, `web/src/**/*.spec.ts`, plus an e2e script per D12.

---

## 4. Phased execution plan (mirrors §12)

1. DB: asset tables + `ASSET_CHECKSUM_CONSTRAINT`; asset_file/exif/metadata; quota columns.
2. DTOs/enums.
3. Storage core + checksum + media-type registry.
4. Service helpers (`canUploadFile`, filename/folder, checksum lookup, `bulkUploadCheck`).
5. `uploadAsset` + `onUploadError` + quota + shared-link attach (catch semantics exact).
6. Interceptors: `AssetUploadInterceptor` then `FileUploadInterceptor` (streaming multer, SHA-1, empty/ECONNRESET).
7. Controller: `POST /assets` (201/200) + `POST /assets/bulk-upload-check` (200).
8. Job pipeline + events (§7).
9. Client: SDK → XHR → worker → manager → store → orchestrator.
10. UI: panel, preview, entry point on `/upload`, drag-drop + paste, SSE refresh.
11. Tests per §10.

---

## 5. §13 checklist — traceability

| #   | §13 item                                     | Where it is implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | How it is proven                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `POST /assets` returns 201/200 per contract  | [`asset-media.controller.ts`](../server/src/controllers/asset-media.controller.ts:52) (201 by default, `200` only when `status === DUPLICATE`); sequence in [`asset-media.service.ts`](../server/src/services/asset-media.service.ts:137)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [`asset-media.controller.spec.ts`](../server/src/controllers/asset-media.controller.spec.ts:1); e2e checks 1 and 2 (`test/upload.e2e.ts`)                                                                                                                                          |
| 2   | Checksum-header **and** DB-constraint dupl.  | Fast path [`asset-upload.interceptor.ts`](../server/src/interceptors/asset-upload.interceptor.ts:30) → [`getUploadAssetIdByChecksum`](../server/src/services/asset-media.service.ts:71); authoritative path is the unique index, detected by [`isAssetChecksumConstraint`](../server/src/utils/checksum.ts:46)                                                                                                                                                                                                                                                                                                                                                                                                                                    | Spec: "decodes a base64 checksum…", "turns a checksum-constraint violation into a duplicate response"; e2e checks 3 and 5                                                                                                                                                          |
| 3   | `POST /assets/bulk-upload-check`             | [`asset-media.controller.ts`](../server/src/controllers/asset-media.controller.ts:79) → [`bulkUploadCheck`](../server/src/services/asset-media.service.ts:258); SDK [`assets.ts`](../packages/sdk/src/assets.ts:10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Spec `bulkUploadCheck` (5 cases incl. trashed + base64 + empty batch); e2e checks 6 and 7                                                                                                                                                                                          |
| 4   | Sharded `upload/…/<uuid>.<ext>` + `.xmp`     | [`storage.ts`](../server/src/utils/storage.ts:48) (`getNestedFolder`); name rule [`getUploadFilename`](../server/src/services/asset-media.service.ts:107) (sidecar always `.xmp`); folder creation [`getUploadFolder`](../server/src/services/asset-media.service.ts:119)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Specs `getUploadFilename`/`getUploadFolder`; e2e checks 4 and 5 assert the two-level shard, bytes and the `.xmp` sidecar                                                                                                                                                           |
| 5   | Quota, type and empty-file errors            | [`requireQuota`](../server/src/services/asset-media.service.ts:304); [`canUploadFile`](../server/src/services/asset-media.service.ts:87) + mime registry [`mime-types.ts`](../server/src/utils/mime-types.ts:101); empty/aborted parts in [`file-upload.interceptor.ts`](../server/src/interceptors/file-upload.interceptor.ts:145) and [`file-not-empty.validator.ts`](../server/src/middleware/file-not-empty.validator.ts:15)                                                                                                                                                                                                                                                                                                                  | Specs `canUploadFile` + quota tests; e2e checks 14 (`File is empty`), 15 (`Unsupported file type notes.txt`), 16 (`Quota has been exceeded!`)                                                                                                                                      |
| 6   | Sidecar, live-photo, metadata, EXIF          | [`uploadAsset`](../server/src/services/asset-media.service.ts:137) steps 5–8; link guard [`onBeforeLink`](../server/src/services/asset-media.service.ts:313). **Shared links / albums are intentionally absent (D3/D4)**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Specs "stores the sidecar as a Sidecar file…", "links a live photo…", "writes user metadata…", "rejects a live photo whose counterpart the caller does not own"; e2e check 5 (sidecar row, `.xmp`, EXIF size)                                                                      |
| 7   | Failure ⇒ files deleted, created row removed | Exact catch block in [`uploadAsset`](../server/src/services/asset-media.service.ts:137): `FileDelete` queue → duplicate re-check → `assets.remove`; interceptor cleanup [`onUploadError`](../server/src/services/asset-media.service.ts:125)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Specs "rolls back the created row and deletes the files when a later write fails", "deletes both parts when the duplicate lookup finds nothing", "rejects an upload that would exceed the quota **and deletes the partial file**"; e2e checks 14–16 assert a zero file-count delta |
| 8   | Pipeline jobs + Timeline/Archive events      | Registered in [`job.service.ts`](../server/src/services/job.service.ts:49); job names [`job.dto.ts`](../server/src/dtos/job.dto.ts:8); `on_upload_success` / `AssetUploadReadyV2` for `timeline`/`archive` only; stream [`event.repository.ts`](../server/src/repositories/event.repository.ts:20) → [`event.controller.ts`](../server/src/controllers/event.controller.ts:16)                                                                                                                                                                                                                                                                                                                                                                    | Verified live (SSE payload observed); stages after metadata are pass-through seams (see §6)                                                                                                                                                                                        |
| 9   | Web client (XHR/worker/queue/state/UI)       | [`upload-request.ts`](../web/src/lib/utils/upload-request.ts:45) (XHR progress + abort) → [`hash-file.worker.ts`](../web/src/lib/workers/hash-file.worker.ts:51) → [`executor-queue.ts`](../web/src/lib/utils/executor-queue.ts:9) (concurrency 2) → [`upload.store.svelte.ts`](../web/src/lib/stores/upload.store.svelte.ts:43) → [`file-uploader.ts`](../web/src/lib/utils/file-uploader.ts:127); UI [`upload-panel.svelte`](../web/src/lib/components/upload/upload-panel.svelte), [`upload-preview-row.svelte`](../web/src/lib/components/upload/upload-preview-row.svelte), [`upload-drop-zone.svelte`](../web/src/lib/components/upload/upload-drop-zone.svelte), wired from [`upload/+page.svelte`](../web/src/routes/upload/+page.svelte) | [`upload.store.spec.ts`](../web/src/lib/stores/upload.store.spec.ts) (9), [`file-uploader.spec.ts`](../web/src/lib/utils/file-uploader.spec.ts) (14), [`executor-queue.spec.ts`](../web/src/lib/utils/executor-queue.spec.ts) (5)                                                  |
| 10  | Tests from §10 pass                          | See "Verification" below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `pnpm check`, `pnpm lint`, `pnpm format`, server 71 unit, web 28 unit, e2e 18 checks                                                                                                                                                                                               |

### Verification (last run)

| Command                                      | Result                                                     |
| -------------------------------------------- | ---------------------------------------------------------- |
| `pnpm check`                                 | 4/4 packages clean (`tsc --noEmit` ×3, `svelte-check` 0/0) |
| `pnpm lint`                                  | 4/4 packages clean (`eslint --max-warnings 0`)             |
| `pnpm format`                                | clean                                                      |
| `pnpm --filter server test`                  | 71 passed / 5 files                                        |
| `pnpm --filter web test`                     | 28 passed / 3 files                                        |
| `DB_PORT=5432 pnpm --filter server test:e2e` | `upload e2e passed (18 checks)`                            |

The e2e runs the **compiled** server (`node dist/main.js`) because tsx/esbuild emits no Nest
decorator metadata; it creates its own user, uses a temp `MEDIA_ROOT`, polls for the asynchronous
`FileDelete`, then cascades the user away. If Postgres is unreachable it prints a skip notice and
exits 0, so it never fails a machine without a database.

---

## 6. Known divergences (deliberate)

- **D3 shared links, D4 albums — skipped.** `auth.sharedLink` is always `null`; `addAssetsToAlbums` is
  an unused seam. §9.9 is therefore not implemented, and §13 item 6 is satisfied for sidecar/live-photo/
  metadata/EXIF only.
- **D5 job queue is in-process, not BullMQ.** Same job names and payloads, still fire-and-forget;
  `JobRepository.queue` never rejects into the upload response.
- **D6 realtime is SSE** (`GET /api/events`) instead of websocket. Event names and payload shapes are
  unchanged; multi-tab duplicate delivery is expected and deduped client-side by asset id.
- **D9 quota is increment-last.** `quotaUsageInBytes` is only bumped after every write succeeds, so a
  failed upload cannot leave the counter drifted. A quota rejection is deliberately raised _inside_ the
  `try` block: the interceptor has already streamed bytes to disk, so the catch block's `FileDelete` is
  what keeps the §6 invariant ("on any failure, no partial files remain") true.
- **Post-metadata pipeline stages are stubs.** `AssetGenerateThumbnails`, `Search`/`SmartSearch`, `Ocr`
  and `AssetEncodeVideo` are registered and chained but write no rows or files — there is no ML service
  in this repo. Ordering and decoupling are real; the work is not.
- **Media types come from `GET /server-info/media-types`** (this repo's endpoint) rather than the
  reference's `GET /server-info` blob. The web converts mime types → extensions via a local
  `MIME_TYPE_EXTENSIONS` map, since browsers only filter file pickers by extension.
- **No trash route and no timeline page.** Trashed duplicates are still flagged in bulk-check
  (`isTrashed`) because the column exists, but nothing sets it. The upload UI refresh targets a bounded
  "Recently processed" feed instead of a full timeline.
- **Identity is a shim (D1).** `x-user-id` header, falling back to the oldest seeded user; unknown ids
  are 401. This is what makes per-user `(ownerId, checksum)` duplicate semantics and exact quota
  assertions testable.
- **Environment note (not a code divergence).** [`server/.env`](../server/.env) targets Postgres on
  `5433` (per [`docker/.env`](../docker/.env)), but the `immich_clone_postgres` container currently
  running on this machine still publishes `5432` — it was created before `DB_HOST_PORT` was moved.
  Recreate it (`cd docker && docker compose -f docker-compose.dev.yml up -d database`) to match the
  documented port, or keep passing `DB_PORT=5432` as the e2e run above did.
