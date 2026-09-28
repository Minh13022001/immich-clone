# Asset Upload — Reimplementation Brief

> **How to use this document:** This is a self-contained, implementation-grade specification of Immich's
> "upload an asset" feature, reverse-engineered from the current codebase. It is written so you can hand it
> (plus the ready-to-paste prompt in §14) to an AI engineering agent and get a behavior-for-behavior
> reimplementation. Section numbers and file paths refer to the reference implementation in this repo.

---

## 1. Objective & scope

Reimplement the end-to-end **asset upload** feature exactly as Immich does it:

1. A client (web/mobile) hashes a file (SHA-1), optionally pre-checks for duplicates, then uploads it as
   `multipart/form-data` to a single endpoint.
2. The server streams the file to disk, computes the hash while streaming, validates the type, records an
   `asset` row + EXIF row, and queues an asynchronous metadata/thumbnail pipeline.
3. When thumbnails finish, the server pushes websocket events so other views live-update.
4. The client shows a progress panel with per-file state (pending/started/done/error/duplicate),
   progress %, speed, ETA, retry, and dismissal.

**In scope:** HTTP contract, duplicate detection (pre-check + server-side constraint), storage layout,
validation, quota, live photo linking, XMP sidecar handling, shared-link uploads, album association,
error cleanup, job pipeline, websocket events, and the full web client flow/UI state.
**Out of scope:** thumbnail/transcoding/ML internals (only the queued jobs and their notifications),
authentication middleware internals, and the mobile Flutter client.

---

## 2. System context & required stack

The reference is a NestJS (TypeScript) server + PostgreSQL (with a checksum uniqueness constraint) + a
job queue (BullMQ) + a SvelteKit (Svelte 5 runes) web client + a generated typed SDK (`@immich/sdk`).

Minimum contracts the server must honor:

- An authenticated request context exposing `auth.user.id`, `auth.sharedLink` (nullable), and permission
  checks for `asset.upload`.
- A durable `asset` table with a **unique constraint on `(ownerId, checksum)`** (named
  `ASSET_CHECKSUM_CONSTRAINT`) — this is the last line of duplicate defense.
- A background job queue supporting named jobs with typed payloads and `source: 'upload' | ...`.
- A websocket channel capable of server → client events addressed to a user.
- A filesystem media root (configurable; default `/usr/src/app/upload` or `/data`).

---

## 3. Domain model

### 3.1 Upload field names (`UploadFieldName`)

| Key            | Value         | Meaning                                      |
| -------------- | ------------- | -------------------------------------------- |
| `ASSET_DATA`   | `assetData`   | The primary binary (image/video). Required.  |
| `SIDECAR_DATA` | `sidecarData` | Optional `.xmp` sidecar part.                |
| `PROFILE_DATA` | `file`        | Used by user-profile upload (reuse pattern). |

### 3.2 Upload status (`AssetMediaStatus`)

`CREATED = 'created'`, `DUPLICATE = 'duplicate'`.

### 3.3 Bulk-check action/reason

`AssetUploadAction`: `ACCEPT='accept'`, `REJECT='reject'`.
`AssetRejectReason`: `DUPLICATE='duplicate'`, `UNSUPPORTED_FORMAT='unsupported-format'`.

### 3.4 Asset fields written on upload

- `ownerId` = authenticated user id
- `libraryId` = `null` (uploads are not external-library assets)
- `checksum` = streamed SHA-1 buffer, `checksumAlgorithm` = `sha1File`
- `originalPath` = absolute path on disk
- `fileCreatedAt`, `fileModifiedAt` = from DTO; `localDateTime` = `fileCreatedAt`
- `type` = derived from extension (`image/*` → Image, `video/*` or `application/mxf` → Video, else Other)
- `isFavorite` = DTO (optional)
- `duration` = DTO or `null`
- `visibility` = DTO or default `Timeline`
- `livePhotoVideoId` = DTO (optional)
- `originalFileName` = `dto.filename || file.originalName`
- EXIF row: `fileSizeInByte` = streamed size (locked override)

### 3.5 Job / event vocabulary

- `JobName.AssetExtractMetadata` with `{ id, source: 'upload' }`
- `JobName.AssetGenerateThumbnails`, then fan-out `SmartSearch`, `AssetDetectFaces`, `Ocr`,
  and `AssetEncodeVideo` (video only). `SmartSearch` with source `upload` queues `AssetDetectDuplicates`.
- Websocket events: **`on_upload_success`** (`AssetResponseDto`) and **`AssetUploadReadyV2`**
  (`{ asset, exif }`), emitted only when `visibility ∈ {Timeline, Archive}`.

---

## 4. HTTP API contract

### 4.1 `POST /assets` — Upload asset

- **Auth:** required; permission `asset.upload`; shared links allowed only when `sharedLink.allowUpload`.
- **Content-Type:** `multipart/form-data`
- **Optional header:** `x-immich-checksum` — a SHA-1 (hex or base64) the client pre-computed. If provided
  and a matching asset already exists for the user, the server **short-circuits** with `200` + duplicate
  body without reading the file body.
- **Multipart parts:**
  - `assetData` (binary, required, max 1)
  - `sidecarData` (binary, optional, max 1)
- **Body fields:**
  - `fileCreatedAt` (ISO datetime, required)
  - `fileModifiedAt` (ISO datetime, required)
  - `duration` (int ms, optional)
  - `filename` (string, optional)
  - `isFavorite` (bool-ish string, optional)
  - `visibility` (enum, optional; default `Timeline`)
  - `livePhotoVideoId` (uuid v4, optional)
  - `metadata` (JSON array of `{ key, value }`, optional)
- **Responses:**
  - `201 Created` → `{ "status": "created", "id": "<uuid>" }`
  - `200 OK` → `{ "status": "duplicate", "id": "<existing-uuid>" }` (pre-check hit **or** caught
    checksum-constraint violation)
  - `400` empty file / unsupported type / quota exceeded; `401` unauthenticated/no upload permission.

### 4.2 `POST /assets/bulk-upload-check` — Duplicate pre-check

- **Auth:** permission `asset.upload` (no shared link).
- **Request:** `{ "assets": [ { "id": "<client-id>", "checksum": "<sha1 hex|base64>" } ] }`
- **Response:**
  ```json
  {
    "results": [
      { "id": "<client-id>", "action": "reject", "reason": "duplicate", "assetId": "<uuid>", "isTrashed": false },
      { "id": "<client-id>", "action": "accept" }
    ]
  }
  ```
- `checksum` decoding: base64 when the decoded length is 28 chars, otherwise hex.

---

## 5. Backend architecture

### 5.1 Controller — `AssetMediaController` (`POST /assets`)

- Decorate with `@Authenticated({ permission: Permission.AssetUpload, sharedLink: true })`.
- Apply interceptors **in this order**: `AssetUploadInterceptor` then `FileUploadInterceptor`
  (the first may short-circuit before multer runs).
- Validate that the `assetData` part is present and non-empty via `FileNotEmptyValidator`.
- Extract `{ file, sidecarFile }` from the parsed files, call the service, and set
  `res.status(200)` when the service returns `DUPLICATE` (Nest otherwise defaults POST to 201).
- `POST /assets/bulk-upload-check` (200) delegates to `service.bulkUploadCheck`.

### 5.2 Interceptor — `AssetUploadInterceptor` (pre-body duplicate fast path)

- Read `x-immich-checksum` (coerce arrays to first element).
- `service.getUploadAssetIdByChecksum(auth, checksum)`; if found, respond `200`
  `{ status: 'duplicate', id }` and **do not** proceed to multer.
- Otherwise continue.

### 5.3 Interceptor — `FileUploadInterceptor` (streaming multer storage)

Implement a custom multer instance shared by all upload routes:

- `fileFilter`: call `assetService.canUploadFile(asUploadRequest(req, file))`; on throw, fail the upload.
- Storage `_handleFile`:
  1. attach `request.on('error')` handler: log; if `ECONNRESET` treat as cancel; always call
     `assetService.onUploadError(req, file)` to queue deletion of any partial file.
  2. assign `file.uuid = randomUUID()`.
  3. compute `path = join(getUploadFolder(req), getUploadFilename(req))`.
  4. create a write stream (`flags: 'w', flush: true`) and pipe `file.stream` into it.
  5. while streaming, accumulate `size`; for `assetData` only, update a SHA-1 hash.
  6. on pipe error → `callback(error)`; if `size === 0` → `BadRequestException('File is empty')`.
  7. on success → `callback(null, { path, size, checksum: hash?.digest() })`.
- Storage `_removeFile`: `unlink(file.path)`.
- Handlers:
  - `assetUpload = instance.fields([{name:'assetData',maxCount:1},{name:'sidecarData',maxCount:1}])`
  - `userProfile = instance.single('file')`
- `getHandler(route)`: map controller `RouteKey.Asset` → `assetUpload`, `RouteKey.User` → `userProfile`.
- `intercept`: run the multer handler inside a promise (translate multer errors), then `next.handle()`.

### 5.4 Service — `AssetMediaService`

**`getUploadAssetIdByChecksum(auth, checksum?)`** → `{ id, status: DUPLICATE } | undefined`

- Return `undefined` if no checksum; decode via `fromChecksum`; look up by `(userId, checksum)`.

**`canUploadFile({ auth, fieldName, file, body })`** → `true` or throw `BadRequestException`

- `requireUploadAccess(auth)` first.
- `filename = body.filename || file.originalName`.
- `assetData` → `mimeTypes.isAsset`; `sidecarData` → `mimeTypes.isSidecar`; `file` → `mimeTypes.isProfile`.
- Else throw `Unsupported file type {filename}`.

**`getUploadFilename({ auth, fieldName, file, body })`** → string

- `requireUploadAccess`.
- extension = original file extension; `sidecarData` always `.xmp`.
- return `sanitize(`${file.uuid}${extension}`)`.

**`getUploadFolder({ auth, fieldName, file })`** → string

- `requireUploadAccess`.
- default = `StorageCore.getNestedFolder(Upload, userId, uuid)` =
  `<mediaRoot>/upload/<userId>/<uuid[0:2]>/<uuid[2:4]>`.
- profile → `<mediaRoot>/profile/<userId>`.
- `mkdirSync(folder)` (recursive) then return it.

**`onUploadError(request, file)`** — compute the would-be path and queue `JobName.FileDelete` for it.

**`uploadAsset(auth, dto, file, sidecarFile?)`** → `AssetMediaResponseDto` (see §6 for sequence).

**`bulkUploadCheck(auth, dto)`** (see §4.2): decode all checksums, `getByChecksums(userId, checksums)`,
build `hex(checksum) → { id, isTrashed: !!deletedAt }`, then map inputs to accept/reject.

**`addToSharedLink(sharedLink, assetId)`** (private):

- If `sharedLink.albumId` is null → `sharedLinkRepository.addAssets(linkId, [assetId])`.
- Else load the album; add asset id; emit `AlbumUpdate` to album users.

**`requireQuota(auth, size)`** (private):

- Throw `BadRequestException('Quota has been exceeded!')` when
  `quotaSizeInBytes !== null && quotaSizeInBytes < quotaUsageInBytes + size`.

### 5.5 Storage layout

```
<mediaRoot>/
  upload/<userId>/<uu>/<uu>/<uuid>.<ext>
  upload/<userId>/<uu>/<uu>/<uuid>.xmp        # sidecar
  profile/<userId>/<uuid>.<ext>
```

`getNestedFolder` uses the first 4 chars of the UUID as a two-level shard.

### 5.6 Validation

- `FileNotEmptyValidator(['assetData'])` on the controller ensures the binary part exists and is non-empty
  (complements the interceptor's `size === 0` check).
- Zod DTOs define the body/multipart schema and mark `assetData` as required binary for OpenAPI
  generation while keeping it `.optional()` for runtime parsing (file parts never reach the body).

---

## 6. `uploadAsset` behavioral sequence (authoritative)

```
requireAccess(permission=AssetUpload, ids=[userId])
requireQuota(auth, file.size)
if dto.livePhotoVideoId: onBeforeLink({ userId, livePhotoVideoId })
asset = assetRepository.create({ ...§3.4 })
if dto.metadata: assetRepository.upsertMetadata(asset.id, metadata)
if sidecarFile:
    assetRepository.upsertFile({ assetId, path: sidecarFile.path, type: Sidecar })
    storageRepository.utimes(sidecarFile.path, now, dto.fileModifiedAt)
storageRepository.utimes(file.path, now, dto.fileModifiedAt)
assetRepository.upsertExif({ assetId, fileSizeInByte: file.size }, lockedPropertiesBehavior='override')
jobRepository.queue(AssetExtractMetadata, { id: asset.id, source: 'upload' })
if auth.sharedLink: addToSharedLink(auth.sharedLink, asset.id)
eventRepository.emit('AssetCreate', { asset, file })
return { id: asset.id, status: CREATED }
```

**Catch block (must be exact):**

```
jobRepository.queue(FileDelete, { files: [file.originalPath, sidecarFile?.originalPath] })
if isAssetChecksumConstraint(error):                 # Postgres unique violation on (ownerId, checksum)
    duplicateId = assetRepository.getUploadAssetIdByChecksum(userId, file.checksum)
    if !duplicateId: throw InternalServerErrorException()
    if auth.sharedLink: addToSharedLink(auth.sharedLink, duplicateId)
    return { status: DUPLICATE, id: duplicateId }     # success-shaped duplicate
if asset: assetRepository.remove({ id: asset.id })   # roll back the row we created
log error + stack; rethrow
```

**Invariants:**

- A byte-equivalent file for the same user yields `duplicate` with the original id, never an error.
- On any failure, no partial files remain and (if a row was created) it is removed.
- The file's mtime is set from the client-provided `fileModifiedAt`, not wall clock.

---

## 7. Job pipeline & websocket events

- `AssetExtractMetadata` extracts EXIF, then the pipeline advances (via `StorageTemplateMigrationSingle`
  for `source ∈ {upload, copy}`) to `AssetGenerateThumbnails`.
- On `AssetGenerateThumbnails` completion, only when `source === 'upload'` **or** `notify` is set:
  - reload asset; queue `SmartSearch`, `AssetDetectFaces`, `Ocr`, and for videos `AssetEncodeVideo`.
  - if `visibility ∈ {Timeline, Archive}`:
    - send `on_upload_success` with the mapped asset,
    - if EXIF exists, send `AssetUploadReadyV2` with `{ asset, exif }`.
- `SmartSearch` with `source === 'upload'` queues `AssetDetectDuplicates`.

---

## 8. Frontend architecture

### 8.1 Request layer (`uploadRequest`)

- Use `XMLHttpRequest` (not `fetch`) to get upload progress + abort.
- POST to `getBaseUrl() + '/assets'` with `FormData`; `responseType = 'json'`.
- Resolve `{ data, status }` on 2xx; otherwise reject with an `ApiError(statusText, status, response)`.
- Register each in-flight xhr so `cancelUploadRequests()` can `abort()` them all (used on logout).

### 8.2 Hashing (`hash-file` web worker)

- Prefer WASM (`hash-wasm` `createSHA1`) and fall back to pure JS (`@noble/hashes`) on failure.
- Read the `File` in 5 MiB slices, update the hasher, return a hex SHA-1.
- Run in a worker to avoid blocking the UI; communicate via `postMessage`/`message` with `{result|error}`.

### 8.3 Upload manager (extensions)

- On app init fetch supported media types from the server (`getSupportedMediaTypes`).
- `getExtensions()` = `image ∪ video` extensions; used to filter the file picker and pre-filter drops.
- `reset()` on logout: cancel in-flight uploads and clear the store.

### 8.4 Upload store (state machine + stats)

- State enum: `PENDING → STARTED → {DONE | ERROR | DUPLICATED}`.
- Item: `{ id, file, albumId?, assetId?, isTrashed?, progress?, state?, startDate?, eta?, speed?, error?, message? }`.
- Derived: `isUploading` (any items), `remainingUploads` (PENDING+STARTED count),
  `isDismissible` (any ERROR/DUPLICATED).
- Stats counters: `total, success, errors, duplicates`.
- API: `addItem` (dedupe by id, increment total), `markStarted`, `updateProgress(loaded,total)`
  (compute speed = loaded/elapsed, progress = floor(loaded/total*100), eta = (total-loaded)/speed),
  `updateItem`, `removeItem` (adjust stats; refuse to remove in-progress), `dismissErrors`, `track`, `reset`.

### 8.5 Orchestrator (`file-uploader.ts`)

- `openFilePicker({multiple, extensions})`: create hidden `<input type=file>`, set `accept`, click,
  resolve `File[]`, remove on change/cancel. Mount in DOM for Safari.
- `openFileUploadDialog({albumId?, multiple?})`: get extensions → `openFilePicker` → `fileUploadHandler`.
- `fileUploadHandler({files, albumId?, isLockedAssets?})`:
  - filter files whose lowercased name ends with a supported extension; warn otherwise.
  - per file: `deviceAssetId = 'web-' + name + '-' + lastModified`; `addItem`;
    enqueue `fileUploader` on an `ExecutorQueue` (default concurrency **2**).
  - await all; return non-empty asset ids.
- `fileUploader({assetFile, deviceAssetId, albumId?, isLockedAssets?})`:
  1. `markStarted`; build `FormData` with `fileCreatedAt`, `fileModifiedAt` (from `lastModified`),
     `isFavorite:'false'`, `assetData = new File([assetFile], name)`; append `visibility=Locked` if locked.
  2. If **not** a shared link: `hashFile` → `checkBulkUpload([{id: name, checksum}])`; if rejected →
     mark `DUPLICATED` (carry `isTrashed`) and skip the POST.
  3. Else/otherwise: `uploadRequest` to `/assets` (+ shared-link query string), tracking progress.
     Accept status `200` or `201`; else throw.
  4. If response status `duplicate` → `track('duplicate')` else `track('success')`.
  5. If `albumId` and not shared link → `addAssetsToAlbums([albumId],[id],{notify:false})`.
  6. Set final state `DUPLICATED` or `DONE`; auto-remove DONE items after ~1s (keep duplicates visible).
  7. On error: if the user logged out mid-upload, return silently; else `track('error')` and set
     `ERROR` with a user-facing message.

### 8.6 UI

- **Upload panel** (floating): shows aggregate progress, per-file rows, concurrency setting (1–50, default 2),
  minimize, dismiss-all-errors; acquires/releases a screen wake lock while uploads remain; on outro shows
  summary toasts (errors → danger, success → primary, duplicates → warning) then resets the store.
- **Upload preview row**: icon by state, progress bar for STARTED, retry button (re-enqueue the file) and
  dismiss button for finished/errored/duplicate items; "view in trash" affordance for trashed duplicates.
- **Entry points**: navbar upload button, album viewer "add photos", shared-viewer upload (when allowed),
  "add to stack", and empty-placeholder buttons on Photos / Recently Added.
- **Drag & drop / paste overlay**: accept `Files`; if the browser supports `webkitGetAsEntry`, recursively
  expand dropped directories into files; also handle paste events; route to `fileUploadHandler` (shared
  links defer until the user confirms). Ignore internal drags.
- **Websocket**: subscribe to `on_upload_success` and inject the asset into the timeline (and other stores)
  for live updates.

---

## 9. Edge cases & required behaviors (acceptance-level)

1. Empty `assetData` → `400 File is empty`; no file left on disk.
2. Unsupported extension → `400 Unsupported file type <name>`; nothing persisted.
3. Same user re-uploads identical bytes → `200 duplicate` with original id (both via header pre-check and
   via caught DB constraint), and for shared links the existing asset is attached to the link.
4. Quota exceeded → `400 Quota has been exceeded!` before persisting.
5. Sidecar `.xmp` is stored as a `Sidecar` asset file; its mtime set to `fileModifiedAt`.
6. Live photo new upload links to an existing motion asset via `onBeforeLink`, and the counterpart is made
   visible.
7. Upload failure after row creation rolls back the row and deletes both original + sidecar.
8. Client disconnect (`ECONNRESET`) cleans up the partial file.
9. Shared-link upload only permitted when `allowUpload`; the created asset is added to the link's album (if
   any) and emits `AlbumUpdate`.
10. `visibility = Locked` uploads are hidden from the normal timeline; websocket `on_upload_success` is only
    emitted for Timeline/Archive.
11. Uploads succeed regardless of whether the thumbnail/ML pipeline later fails (pipeline is async).

---

## 10. Testing requirements

- **Server unit tests:** `canUploadFile` (accept/reject per field), `getUploadFilename` (extensions, sidecar
  `.xmp`, bare `.jpg`), `getUploadFolder` (nested sharding, profile), `uploadAsset` (quota, create, sidecar,
  live photo linking, checksum-constraint duplicate, GenericError cleanup), `onUploadError`, `bulkUploadCheck`,
  and controller-level duplicate → 200 behavior.
- **Client unit tests:** `fileUploadHandler`/`fileUploader` transition to done/error/duplicate, duplicate
  pre-check short-circuit, logout mid-upload silent handling, retry path, and store stat accounting.
- **E2E:** upload a file → appears in timeline via websocket; duplicate upload skips; quota rejection.

---

## 11. Non-functional requirements

- Streaming: never buffer the whole file in memory; hash incrementally.
- Backpressure & cancellation: abort all in-flight uploads on logout/navigation.
- Security: sanitize filenames; enforce permission checks on both the fast path and the service; never trust
  client-provided checksum without also enforcing the DB unique constraint.
- Idempotency: duplicate detection is best-effort on the client, authoritative on the server.
- Resilience: async pipeline failures must not fail the upload response.

---

## 12. Suggested implementation order

1. DB: `asset` table + `(ownerId, checksum)` unique constraint; `asset_file`, `exif` tables.
2. DTOs/enums: upload fields, create DTO, response DTO, bulk-check DTOs.
3. Storage core: media root resolution + nested folder helper.
4. Media-type registry: extension → mime → asset type; `isAsset/isSidecar/isProfile`.
5. Service: `canUploadFile`, filename/folder helpers, `getUploadAssetIdByChecksum`, `bulkUploadCheck`,
   `uploadAsset`, `onUploadError`, quota, shared-link attach.
6. Interceptors: `FileUploadInterceptor` (multer streaming) then `AssetUploadInterceptor` (header dedupe).
7. Controller: `POST /assets` (201/200) and `POST /assets/bulk-upload-check`.
8. Job pipeline + websocket events.
9. Client: SDK endpoints → XHR request layer → hash worker → manager → store → orchestrator.
10. UI: upload panel, preview row, entry points, drag/drop overlay, websocket subscription.
11. Tests per §10.

---

## 13. Definition of done (checklist)

- [ ] `POST /assets` accepts multipart `assetData` (+ optional `sidecarData`) and returns 201/200 per contract.
- [ ] `x-immich-checksum` fast-path and DB-constraint duplicate handling both return `{status:'duplicate',id}`.
- [ ] `POST /assets/bulk-upload-check` returns accept/reject with `assetId`/`isTrashed`.
- [ ] Files stored under sharded `upload/<userId>/<uu>/<uu>/<uuid>.<ext>`; sidecar as `.xmp`.
- [ ] Quota, type, and empty-file validations enforced with the exact error messages.
- [ ] Sidecar, live-photo, metadata, EXIF, and shared-link/album behaviors implemented.
- [ ] On failure: files deleted and created rows rolled back.
- [ ] `AssetExtractMetadata → AssetGenerateThumbnails → (SmartSearch/Faces/Ocr/EncodeVideo)` queued;
      `on_upload_success` + `AssetUploadReadyV2` emitted for Timeline/Archive only.
- [ ] Web client: XHR upload with progress + cancel; SHA-1 worker; concurrency queue (default 2);
      state machine + stats; panel, preview, retry/dismiss; drag-drop incl. directories and paste.
- [ ] Tests from §10 pass.

---

## 14. Ready-to-paste prompt for the AI agent

> **Task: Reimplement the "upload an asset" feature to match the attached specification exactly.**
>
> You are implementing in **[NestJS + TypeScript + PostgreSQL + BullMQ] server / [SvelteKit + Svelte 5] client**
> (replace with your stack). Follow `docs/asset-upload-reimplementation-brief.md` as the source of truth.
> Match the HTTP contract (§4), backend architecture (§5), the `uploadAsset` sequence and its catch-block
> semantics (§6), the job/websocket pipeline (§7), and the client flow (§8) behavior-for-behavior, including
> error messages and status codes. Honor all edge cases in §9 and satisfy the acceptance checklist in §13.
>
> Constraints:
>
> 1. Stream uploads to disk with incremental SHA-1; never buffer entire files.
> 2. Enforce the `(ownerId, checksum)` unique DB constraint as the authoritative duplicate defense, and keep
>    the checksum-header and bulk-check fast paths as optimizations that must agree with it.
> 3. On any failure, delete partially written files and roll back any created asset row.
> 4. Keep the async metadata/thumbnail pipeline decoupled from the upload response.
> 5. Implement the client exactly as specified: XHR progress, cancellable uploads, worker-based hashing,
>    concurrency queue (default 2), the PENDING→STARTED→DONE/ERROR/DUPLICATED state machine, and the
>    drag-and-drop/paste/directory ingestion.
>
> Deliverables: server controller/interceptors/service/DTOs, storage + media-type utils, job + websocket
> wiring, client request layer + worker + manager + store + orchestrator + UI components, and the tests
> listed in §10. Provide a short traceability note mapping each deliverable to the spec section it satisfies.
