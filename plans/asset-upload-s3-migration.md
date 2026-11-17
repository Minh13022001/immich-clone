# Asset Upload — Direct-to-S3 Migration

Reference document for the change from **client → API → Multer → local disk → DB**
to **client → presigned URL → object store → API verifies → DB**.

Read this together with [`plans/asset-upload-decisions.md`](./asset-upload-decisions.md),
which records _why_ each choice was made. This file records _what the system does now_.

---

## 1. Flow, before and after

### Before

```text
browser ──multipart POST /api/assets──► API ──Multer stream──► MEDIA_ROOT/<uuid>.<ext>
                                          └──INSERT asset──► Postgres
                                          └──job──► thumbnails / metadata / …
```

The API was in the data path for every byte: it held the request open for the whole
transfer, wrote to local disk, and computed the SHA-1 only after the file had landed.

### After

```text
1. browser   POST /api/assets/uploads                    declare name, size, type, SHA-1
2. API       validate + reserve quota + INSERT asset_upload (pending) + presign
3. browser   PUT <presigned>                             bytes go straight to the store
4. browser   POST /api/assets/uploads/:id/complete       "I am done"
5. API       HeadObject → size → digest → dedupe → INSERT asset → commit quota
6. API       202 + AssetUploadReadyV2 event → background jobs read from the store
```

The API never touches the bytes on the way in. It authorises an exact object
(key, size, content type, digest), then verifies afterwards that the object it finds
is the object it authorised.

Large files switch to multipart: `POST /api/assets/uploads/:id/parts` mints part
URLs on demand, `ListParts` is the authority at completion, and the client’s part
list only has to _agree_ with it.

---

## 2. What the client can and cannot influence

The migration had one hard rule: **do not trust the client**. Concretely:

| Client-supplied      | Used for                                  | Verified against                           |
| -------------------- | ----------------------------------------- | ------------------------------------------ |
| `fileSize`           | presigning, quota reservation, part count | `HeadObject` size at `/complete`           |
| `contentType`        | the signed header                         | signed into the URL; S3 rejects a mismatch |
| `checksum` (SHA-1)   | dedupe lookup, presigned header           | re-derived from the stored object          |
| part numbers / ETags | nothing authoritative                     | `ListParts` result                         |

So a forged checksum cannot be used to claim somebody else’s bytes: the duplicate
check runs **after** the digest has been re-derived from storage, never before.
If verification fails the object is deleted, the reservation is released, and the
session is marked `failed` — no asset row is created.

Two digest paths exist for a reason:

- **Single part.** S3 can prove `x-amz-checksum-sha1` itself, and `HeadObject`
  reports it. That value is used directly.
- **Multipart / local backend.** A composite multipart digest is not the SHA-1 of
  the whole file, and the local backend has no checksum support, so the object is
  re-read and hashed server-side (`hashObject`).

---

## 3. API surface

Unchanged (the legacy multipart upload still works and is still the path for
`POST /accounts/profile`):

```text
POST /api/assets                    multipart/form-data     201 created / 200 duplicate
POST /api/assets/bulk-upload-check  JSON                     per-asset accept/reject
GET  /api/assets/:id/thumbnail
GET  /api/assets/:id/original       Range-capable
GET  /api/server-info               now includes `storage`
GET  /api/server-info/media-types
```

Added:

| Method | Path                               | Purpose                                                                                        |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `POST` | `/api/assets/uploads`              | Declare an upload; returns either a duplicate, a single presigned PUT, or a multipart contract |
| `POST` | `/api/assets/uploads/:id/parts`    | Presign a bounded batch of part URLs (≤ 100 per call)                                          |
| `POST` | `/api/assets/uploads/:id/complete` | Verify the object, then finalise the asset                                                     |
| `POST` | `/api/assets/uploads/:id/abort`    | Tear the session down; idempotent                                                              |
| `PUT`  | `/api/uploads/local/:token`        | **Local backend only.** Stands in for S3’s presigned PUT                                       |

`GET /api/server-info` gained `storage`, and it is the _only_ place upload limits are
published. The web client reads `maxUploadSize`, `multipartThreshold` and `partSize`
from there rather than keeping its own copy, so a fail-fast message in the browser is
word-for-word the message the server would have produced.

```jsonc
{
  "storage": {
    "backend": "local",
    "maxUploadSize": 21474836480,
    "multipartThreshold": 67108864,
    "partSize": 8388608,
    "multipart": false,
  },
}
```

### Breaking changes

1. **`POST /api/assets` is no longer how a normal client uploads.** It still works,
   but it is now a compatibility path; the direct flow is the supported one.
2. **A new client cannot upload without `GET /api/server-info`** — the limits and,
   for the web client, the storage backend both come from it.
3. **`server-info` response shape changed** (added `storage`). Additive, so only
   clients that assert on an exact shape are affected.
4. **Duplicate detection moved a step earlier for direct uploads.** `POST /assets/uploads`
   can now answer `status: "duplicate"` before any byte is sent, which the legacy
   form-post path could not do.

---

## 4. Data model

Three migrations, all additive:

| Migration                          | Effect                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `1800000000000-CreateAssetUpload`  | `asset_upload` table + partial unique index `ASSET_UPLOAD_ACTIVE_CHECKSUM` on `(ownerId, checksum)` for non-terminal rows |
| `1800000000001-MakeChecksumUnique` | unique index `ASSET_CHECKSUM_CONSTRAINT` on `asset(ownerId, checksum)`                                                    |
| `1800000000002-AddStorageColumns`  | `asset.storageBackend`, `asset.storageKey`; `users.quotaReservedInBytes`                                                  |

`asset_upload` is a session, not an asset. It records what was authorised
(`declaredSize`, `declaredContentType`, `checksum`, `storageKey`, `partSize`,
`reservedBytes`, the snapshot of the create-DTO fields), how far it got
(`status`, `multipartUploadId`, `parts`, `attempts`, `error`) and when it stops
being valid (`expiresAt`).

Session states:

```text
pending ──► verifying ──► completed
   │            │
   ├──► aborted ├──► duplicate
   ├──► expired └──► failed
```

`completed`, `duplicate`, `aborted`, `expired` and `failed` are terminal. The
partial unique index only covers non-terminal rows, so the same bytes can be
uploaded again after a failure while a genuine retry still joins the live session.

**Quota** is now a two-phase reservation on `users`:

- `reserveQuota` at `/initiate` — an upload you cannot afford never gets a URL.
- `commitQuota` at `/complete` — moves reserved bytes into usage.
- `releaseQuota` at abort / expiry / verification failure / duplicate.

This is what stops N concurrent uploads from each seeing “enough room left” and
collectively blowing the quota.

---

## 5. Where the code lives now

```text
server/src/
├── repositories/
│   ├── object-storage.repository.ts    S3 + local backend: presign, head, hash, stream,
│   │                                   multipart create/parts/complete/abort, delete
│   ├── asset-upload.repository.ts      session CRUD; claim-for-verification, claim-for-cleanup,
│   │                                   listExpired, listStuckVerifying
│   └── user.repository.ts              + reserveQuota / commitQuota / releaseQuota
├── services/
│   ├── asset-upload.service.ts         initiate / requestParts / complete / abort
│   ├── asset-finalizer.service.ts      asset INSERT + metadata + live photo + event
│   │                                   (extracted from AssetMediaService#uploadAsset so
│   │                                   the legacy and direct paths share one finaliser)
│   ├── upload-cleanup.service.ts       interval sweep of expired + stuck sessions
│   └── asset-media.service.ts          now storage-aware for reads
├── controllers/
│   ├── asset-upload.controller.ts      the four endpoints
│   └── local-upload.controller.ts      local backend PUT sink
├── interceptors/
│   ├── asset-upload.interceptor.ts     pre-body duplicate fast path (200 instead of 201)
│   └── file-upload.interceptor.ts      streaming Multer storage, SHA-1 as it writes
└── utils/storage-keys.ts               sharded, traversal-safe object keys
```

```text
web/src/lib/
├── utils/
│   ├── direct-uploader.ts      assertUploadable → initiate → PUT (single/multipart) → complete
│   ├── upload-request.ts       XHR transport for a presigned URL, shared abort registry
│   ├── hash-file.ts            SHA-1 in a web worker
│   └── file-uploader.ts        orchestrator: hash → pre-check → direct upload → store
├── stores/upload.store.svelte.ts   + `phase` and `uploadId` per item
└── managers/upload-manager.svelte.ts   `loadServerConfig()`: media types + capabilities
```

The `ExecutorQueue` concurrency limit, XHR progress reporting, abort-on-logout and
the upload store’s state machine are all carried over unchanged in behaviour — only
the transport underneath them changed.

---

## 6. Object keys and access

Keys are owner-sharded and contain no user input:

```text
original/<ownerId>/<uploadId>/<uuid><ext>
```

`storage-keys.ts` rejects `..`, absolute paths and backslashes, so a key can never
escape the bucket prefix or the local root.

Buckets are **private**. There is no public read path: the API streams originals and
thumbnails itself, and the only URLs a browser ever receives are short-lived signed
PUTs (write-only, bound to one key, one size, one content type, one digest). Nothing
in the flow requires making an object public.

---

## 7. Failure and cleanup

| Situation                                    | Outcome                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Client never finishes                        | `UploadCleanupService` sweeps `expiresAt < now`: abort multipart, delete object, release quota, mark `expired` |
| Process dies inside `/complete`              | Row stays `verifying`; swept after `UPLOAD_VERIFY_TIMEOUT_MS` (30 min) as `failed`                             |
| Digest or size mismatch                      | Object deleted, quota released, session `failed`, 400 to the client                                            |
| Two `/complete` calls race                   | `claimForVerification` is one atomic UPDATE; the loser replays the winner’s result                             |
| Two `/initiate` calls for the same bytes     | Partial unique index admits one; the loser is answered with the winner’s session                               |
| Bytes turn out to be a duplicate             | Object deleted, quota released, session `duplicate`, asset id returned with a `duplicate` status               |
| Tab killed mid-PUT                           | Bucket-level lifecycle rule aborts incomplete multipart uploads after 1 day                                    |
| Concurrent asset INSERT with the same digest | `23505` on `ASSET_CHECKSUM_CONSTRAINT` is caught and converted into a duplicate response                       |

---

## 8. Configuration

| Variable                                    | Default                      | Meaning                                                            |
| ------------------------------------------- | ---------------------------- | ------------------------------------------------------------------ |
| `STORAGE_BACKEND`                           | `local`                      | `local` = disk under `MEDIA_ROOT`, `s3` = presigned direct uploads |
| `MEDIA_ROOT`                                | `./data`                     | Filesystem root; holds `objects/` for the local backend            |
| `PUBLIC_API_URL`                            | `http://localhost:2283`      | Browser-reachable API base, used to sign local PUT links           |
| `UPLOAD_TOKEN_SECRET`                       | dev value                    | HMAC key for local PUT tokens; **must** be set in production       |
| `PRESIGN_TTL_SECONDS`                       | `900`                        | Lifetime of a presigned URL / upload deadline                      |
| `UPLOAD_SESSION_TTL_SECONDS`                | `3600`                       | Age at which an abandoned session is swept                         |
| `MULTIPART_THRESHOLD`                       | `67108864`                   | Above this size, uploads go multipart                              |
| `PART_SIZE`                                 | `8388608`                    | Multipart part size (≥ 5 MiB, S3 rule)                             |
| `MAX_UPLOAD_SIZE`                           | `21474836480`                | Hard ceiling, enforced before any URL is issued                    |
| `S3_ENDPOINT`                               | —                            | S3 API as seen by the **server** (`http://minio:9000` in Docker)   |
| `S3_PUBLIC_ENDPOINT`                        | falls back to `S3_ENDPOINT`  | S3 API as seen by the **browser** (`http://localhost:9000`)        |
| `S3_REGION` / `S3_BUCKET`                   | `us-east-1` / `immich-clone` | —                                                                  |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | —                            | Required when `STORAGE_BACKEND=s3`; boot fails without them        |
| `S3_FORCE_PATH_STYLE`                       | `false`                      | `true` for MinIO and most gateways                                 |

`S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` are separate on purpose: **the signature
covers the `Host` header**, so a URL signed against `minio:9000` is invalid in a
browser that connects to `localhost:9000`. The server therefore creates two clients
from the same credentials — one to call, one to sign.

---

## 9. Running it

### Local backend (default, no object store needed)

```bash
pnpm install
docker compose -f docker/docker-compose.dev.yml up -d database
pnpm migrations:run
pnpm dev
```

### S3 backend with MinIO

```bash
cp docker/.env.example docker/.env      # set STORAGE_BACKEND=s3
docker compose -f docker/docker-compose.dev.yml up -d minio minio-init
```

`minio-init` creates the private bucket, sets CORS and adds the
abort-incomplete-multipart lifecycle rule. Three details are load-bearing:

1. **`Access-Control-Expose-Headers: ETag`.** `CompleteMultipartUpload` needs the
   part ETags, and CORS hides response headers from JavaScript unless they are
   named. Without it a multipart upload from the browser can never complete.
   `docker/minio/bootstrap.sh` sets this; a hand-built bucket must too.
2. **The published S3 port must equal `S3_PUBLIC_ENDPOINT`.** Change
   `MINIO_HOST_PORT` and you must change `S3_PUBLIC_ENDPOINT` with it.
3. **`CORS_ORIGIN` must be the exact origin you browse with.** `http://localhost:3000`
   and `http://127.0.0.1:3000` are different origins to a browser.

Running the API on the host against containerised MinIO:

```bash
STORAGE_BACKEND=s3 \
S3_ENDPOINT=http://localhost:9000 \
S3_PUBLIC_ENDPOINT=http://localhost:9000 \
S3_FORCE_PATH_STYLE=true \
S3_ACCESS_KEY_ID=minioadmin S3_SECRET_ACCESS_KEY=minioadmin \
pnpm dev:server
```

### Production notes

- Bucket stays private. Grant only `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`,
  `s3:ListMultipartUploadParts`, `s3:AbortMultipartUpload`, `s3:ListBucket`.
- Set a real `UPLOAD_TOKEN_SECRET`; the default exists so `pnpm dev` works with no
  `.env`.
- Keep `PRESIGN_TTL_SECONDS` short. Every second is a window in which a leaked URL
  can be written to.
- Add the bucket-level rule aborting incomplete multipart uploads; the API sweep only
  sees sessions it recorded.

---

## 10. Verification

```bash
pnpm check                                     # sdk, server, cli tsc + web svelte-check
pnpm --filter ./server exec vitest run         # 6 files, 89 tests
pnpm --filter ./web    exec vitest run         # 3 files, 30 tests
docker compose -f docker/docker-compose.dev.yml config --quiet
```

Last run: all green, `svelte-check found 0 errors and 0 warnings`.

The suites that cover this work:

- `server/src/services/asset-media.service.spec.ts` — legacy upload, checksum
  decoding, duplicate constraint handling, storage-backed reads with range clamping
- `server/src/services/upload-cleanup.service.spec.ts` — expiry, stuck-verifying
  reclaim, refund failure ordering, sweep overlap, interval registration
- `server/src/controllers/asset-media.controller.spec.ts` — 201-vs-200 duplicate
  semantics, empty-file 400, byte-range responses
- `web/src/lib/utils/file-uploader.spec.ts` — hash → pre-check → direct upload →
  store transitions, phase/uploadId publication, duplicate short-circuits, abort
  silence, pre-hash rejection of empty and over-size files
- `web/src/lib/utils/executor-queue.spec.ts`, `web/src/lib/stores/upload.store.spec.ts`

---

## 11. Deliberate divergences

These are intentional; see the decisions document for the reasoning.

| Reference behaviour           | Here                                                           | Why                                                                                    |
| ----------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| BullMQ + Redis job queue      | In-process serial `JobRepository` + `setInterval(...).unref()` | The clone has no Redis and the brief allows a stand-in; the seam is a single interface |
| WebSocket events              | Server-sent events                                             | Same fan-out, no extra dependency                                                      |
| `x-immich-user-token` auth    | `x-user-id` shim with a seeded default user                    | No auth module in this clone (D1)                                                      |
| Shared links, albums          | Not implemented                                                | Out of scope (D3, D4)                                                                  |
| XMP sidecar upload            | Not implemented                                                | Explicitly out of scope for this migration                                             |
| pgvector semantic search      | `SmartSearch` is a stub job                                    | No embeddings in this clone                                                            |
| S3 multipart on every backend | Multipart is S3-only; local backend is single-PUT              | A local multipart stand-in would add failure modes without adding coverage             |

One real behavioural difference worth flagging: the legacy `POST /assets` path still
writes into `MEDIA_ROOT` and stores no `storageKey`. Assets created that way keep
working (the reader falls back to the filesystem), but they are not visible to the
cleanup sweep and are not deduplicated against direct uploads until a second
upload of the same bytes lands.
