/**
 * End-to-end upload check (brief §10, §13).
 *
 * Drives the real HTTP surface against the real Postgres from `server/.env`:
 *
 *   POST /api/assets                     201 created / 200 duplicate / 400s
 *   POST /api/assets/bulk-upload-check   accept / reject / empty batch
 *
 * The server under test is the *compiled* one (`node dist/main.js`) rather than a
 * tsx-loaded entrypoint: Nest resolves constructor dependencies from the
 * `design:paramtypes` metadata, and only `tsc` (through `nest build`) emits it.
 * This script itself runs under tsx.
 *
 * Every run is isolated. A dedicated user is created (the developer's own data is
 * untouched), originals land in a temporary `MEDIA_ROOT`, and the user row is
 * deleted afterwards — which cascades to its assets, files and metadata. If
 * Postgres or the migrations are unavailable the script prints a skip notice and
 * exits 0, so a machine without a dev database reports "skipped", never "failed".
 *
 * Usage: `pnpm --filter server test:e2e`.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { Client } from 'pg';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHECKSUM_HEADER = 'x-immich-checksum';
const CREATED_AT = '2024-05-01T10:00:00.000Z';
const MODIFIED_AT = '2024-05-02T11:30:00.000Z';
const FILENAME = 'photo.jpg';

interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface HttpResult {
  status: number;
  body: unknown;
}

interface UploadOptions {
  bytes: Buffer;
  filename: string;
  sidecar?: { bytes: Buffer; filename: string };
  /** When set, the request carries `x-immich-checksum` (the pre-body fast path). */
  checksumHeader?: string;
}

interface AssetRow {
  id: string;
  ownerId: string;
  checksumHex: string;
  originalPath: string;
  originalFileName: string;
  type: string;
  visibility: string;
  isFavorite: boolean;
  checksumAlgorithm: string;
}

interface BulkResult {
  id: string;
  action: string;
  reason?: string;
  assetId?: string;
  isTrashed?: boolean;
}

interface ServerHandle {
  child: ChildProcess;
  /** Everything the child has written, for diagnostics when a check fails. */
  output: () => string;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

let checks = 0;

function ok(message: string): void {
  checks += 1;
  console.log(`  \u2713 ${message}`);
}

function info(message: string): void {
  console.log(`  \u00b7 ${message}`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha1Hex(bytes: Buffer): string {
  return createHash('sha1').update(bytes).digest('hex');
}

function sha1Base64(bytes: Buffer): string {
  return createHash('sha1').update(bytes).digest('base64');
}

function asRecord(body: unknown): Record<string, unknown> {
  assert.ok(
    typeof body === 'object' && body !== null,
    `expected a JSON object body, received ${JSON.stringify(body)}`,
  );

  return body as Record<string, unknown>;
}

/** Minimal `KEY=VALUE` reader; `server/.env` is the only input. */
function readDotEnv(file: string): Record<string, string> {
  if (!existsSync(file)) {
    return {};
  }

  const values: Record<string, string> = {};

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) {
      continue;
    }

    values[key] = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }

  return values;
}

function resolveDbConfig(fileEnv: Record<string, string>): DbConfig {
  const pick = (key: string, fallback: string): string =>
    process.env[key] ?? fileEnv[key] ?? fallback;

  return {
    host: pick('DB_HOST', 'localhost'),
    port: Number(pick('DB_PORT', '5432')),
    user: pick('DB_USERNAME', 'postgres'),
    password: pick('DB_PASSWORD', 'postgres'),
    database: pick('DB_DATABASE_NAME', 'immich'),
  };
}

/** Locates the package directory, from either `server/` or the repo root. */
function resolveServerDir(): string {
  for (const candidate of [process.cwd(), join(process.cwd(), 'server')]) {
    if (existsSync(join(candidate, 'dist', 'main.js'))) {
      return candidate;
    }
  }

  throw new Error(
    'dist/main.js not found: run this through `pnpm --filter server test:e2e` so the server is built',
  );
}

/** Every file below `root`, sorted; `[]` when the tree does not exist yet. */
function walkFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const dir = pending.pop() as string;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else {
        files.push(full);
      }
    }
  }

  return files.sort();
}

/**
 * Waits for background `FileDelete` jobs to bring the on-disk file count back to
 * `expected`. Cleanup is queued by the same response that reports the failure, so
 * asserting immediately would race the job chain.
 */
async function waitForFileCount(root: string, expected: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (walkFiles(root).length === expected) {
      return;
    }

    await sleep(50);
  }

  const remaining = walkFiles(root).map((file) => relative(root, file));
  assert.fail(`expected ${expected} files under the media root, found ${remaining.join(', ')}`);
}

function findFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();

      if (address === null || typeof address === 'string') {
        probe.close();
        rejectPort(new Error('could not allocate a port for the test server'));
        return;
      }

      const { port } = address;
      probe.close(() => resolvePort(port));
    });
  });
}

function startServer(options: {
  serverDir: string;
  port: number;
  mediaRoot: string;
  dbConfig: DbConfig;
}): ServerHandle {
  const log: string[] = [];
  const capture = (chunk: Buffer): void => {
    log.push(chunk.toString());
    if (log.length > 400) {
      log.shift();
    }
  };

  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: options.serverDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(options.port),
      MEDIA_ROOT: options.mediaRoot,
      CORS_ORIGINS: 'http://localhost:3000',
      DB_HOST: options.dbConfig.host,
      DB_PORT: String(options.dbConfig.port),
      DB_USERNAME: options.dbConfig.user,
      DB_PASSWORD: options.dbConfig.password,
      DB_DATABASE_NAME: options.dbConfig.database,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  return { child, output: () => log.join('') };
}

async function stopServer(handle: ServerHandle): Promise<void> {
  const { child } = handle;

  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
  child.kill('SIGTERM');

  const graceful = await Promise.race([exited.then(() => true), sleep(5_000).then(() => false)]);

  if (!graceful) {
    child.kill('SIGKILL');
    await exited;
  }
}

async function waitForHealth(baseUrl: string, handle: ServerHandle): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (handle.child.exitCode !== null) {
      throw new Error(`server exited with code ${handle.child.exitCode} before becoming healthy`);
    }

    try {
      const result = await send(baseUrl, '/api/health');
      if (result.status === 200) {
        return;
      }
    } catch {
      // Not listening yet; keep polling.
    }

    await sleep(200);
  }

  throw new Error('server did not answer GET /api/health within 30s');
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function send(baseUrl: string, path: string, init?: RequestInit): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();

  let body: unknown;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, body };
}

function buildUploadForm(options: UploadOptions): FormData {
  const form = new FormData();
  form.set('fileCreatedAt', CREATED_AT);
  form.set('fileModifiedAt', MODIFIED_AT);
  form.set(
    'assetData',
    new File([new Uint8Array(options.bytes)], options.filename, {
      type: 'application/octet-stream',
    }),
  );

  if (options.sidecar) {
    form.set(
      'sidecarData',
      new File([new Uint8Array(options.sidecar.bytes)], options.sidecar.filename, {
        type: 'application/xml',
      }),
    );
  }

  return form;
}

function upload(baseUrl: string, userId: string, options: UploadOptions): Promise<HttpResult> {
  const headers: Record<string, string> = { 'x-user-id': userId };

  if (options.checksumHeader !== undefined) {
    headers[CHECKSUM_HEADER] = options.checksumHeader;
  }

  return send(baseUrl, '/api/assets', {
    method: 'POST',
    headers,
    body: buildUploadForm(options),
  });
}

function createUser(baseUrl: string, name: string, email: string): Promise<HttpResult> {
  return send(baseUrl, '/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email }),
  });
}

function bulkUploadCheck(
  baseUrl: string,
  userId: string,
  assets: { id: string; checksum: string }[],
): Promise<HttpResult> {
  return send(baseUrl, '/api/assets/bulk-upload-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify({ assets }),
  });
}

// ---------------------------------------------------------------------------
// database helpers
// ---------------------------------------------------------------------------

async function fetchAssetRow(client: Client, id: string): Promise<AssetRow | undefined> {
  const result = await client.query<AssetRow>(
    `select id,
            "ownerId",
            encode(checksum, 'hex') as "checksumHex",
            "originalPath",
            "originalFileName",
            type,
            visibility,
            "isFavorite",
            "checksumAlgorithm"
       from asset
      where id = $1`,
    [id],
  );

  return result.rows[0];
}

async function countAssetsWithChecksum(
  client: Client,
  ownerId: string,
  checksumHex: string,
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count
       from asset
      where "ownerId" = $1 and checksum = decode($2, 'hex')`,
    [ownerId, checksumHex],
  );

  return Number(result.rows[0].count);
}

async function fetchQuotaUsage(client: Client, userId: string): Promise<number> {
  const result = await client.query<{ quotaUsageInBytes: string }>(
    'select "quotaUsageInBytes" from users where id = $1',
    [userId],
  );

  return Number(result.rows[0].quotaUsageInBytes);
}

function setQuota(
  client: Client,
  userId: string,
  quotaSizeInBytes: number | null,
): Promise<unknown> {
  return client.query('update users set "quotaSizeInBytes" = $2 where id = $1', [
    userId,
    quotaSizeInBytes,
  ]);
}

// ---------------------------------------------------------------------------
// the check itself
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const serverDir = resolveServerDir();
  const fileEnv = readDotEnv(join(serverDir, '.env'));
  const dbConfig = resolveDbConfig(fileEnv);

  const client = new Client({ ...dbConfig });
  try {
    await client.connect();
    // Touch the tables the upload path needs; a fresh database is still un-migrated.
    await client.query('select 1 from users limit 1');
    await client.query('select 1 from asset limit 1');
  } catch (error) {
    console.log(`skipping upload e2e: ${describe(error)}`);
    console.log('  start Postgres and run `pnpm --filter server migrations:run` to enable it');
    await client.end().catch(() => undefined);
    return;
  }

  const mediaRoot = mkdtempSync(join(tmpdir(), 'immich-upload-e2e-'));
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const handle = startServer({ serverDir, port, mediaRoot, dbConfig });

  let ownerId = '';

  console.log(`upload e2e against ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  info(`server on ${baseUrl}, media root ${mediaRoot}`);

  try {
    await waitForHealth(baseUrl, handle);
    ok('GET /api/health is up (database reachable)');

    // A dedicated user keeps the run isolated from whatever the developer has in
    // the shared dev database; deleting it at the end cascades to every row this
    // script creates.
    const runId = `${process.pid}-${Date.now()}`;
    const createdUser = await createUser(baseUrl, 'Upload E2E', `upload-e2e-${runId}@example.com`);
    assert.equal(createdUser.status, 201, `unexpected user status: ${describe(createdUser.body)}`);
    ownerId = String(asRecord(createdUser.body).id);
    assert.match(ownerId, UUID_PATTERN);
    ok(`created an isolated user ${ownerId}`);

    // Distinct bytes per run so a leftover row from an aborted run can never turn
    // this into a spurious duplicate.
    const assetBytes = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from(`immich-e2e-${runId}`),
    ]);
    const sidecarBytes = Buffer.from(
      `<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>${runId}`,
    );
    const otherBytes = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
      Buffer.from(`immich-e2e-other-${runId}`),
    ]);
    const checksumHex = sha1Hex(assetBytes);
    const otherChecksumHex = sha1Hex(otherBytes);

    // --- 1. a fresh upload is created, persisted, billed and stored on disk ----
    const created = await upload(baseUrl, ownerId, {
      bytes: assetBytes,
      filename: FILENAME,
      sidecar: { bytes: sidecarBytes, filename: 'photo.xmp' },
    });

    assert.equal(created.status, 201, `unexpected create status: ${JSON.stringify(created.body)}`);
    const createdBody = asRecord(created.body);
    assert.deepEqual(Object.keys(createdBody).sort(), ['id', 'status']);
    assert.equal(createdBody.status, 'created');
    const assetId = String(createdBody.id);
    assert.match(assetId, UUID_PATTERN);
    ok(`POST /api/assets returned 201 {status:created} for ${assetId}`);

    const assetRow = await fetchAssetRow(client, assetId);
    assert.ok(assetRow, 'the created asset row should exist');
    assert.equal(assetRow.checksumHex, checksumHex, 'stored digest must be the streamed SHA-1');
    assert.equal(assetRow.originalFileName, FILENAME);
    assert.equal(assetRow.checksumAlgorithm, 'sha1File');
    assert.equal(assetRow.type, 'IMAGE', 'type is derived from the extension');
    assert.equal(assetRow.visibility, 'timeline');
    assert.equal(assetRow.isFavorite, false);
    ok('asset row holds the SHA-1, extension-derived type and documented defaults');

    const originalPath = assetRow.originalPath;
    const fileUuid = basename(originalPath).replace(/\.[^.]+$/, '');
    assert.match(fileUuid, UUID_PATTERN, 'the stored name is a generated uuid plus extension');
    assert.equal(originalPath.slice(-4), '.jpg');
    assert.equal(
      dirname(originalPath),
      join(mediaRoot, 'upload', ownerId, fileUuid.slice(0, 2), fileUuid.slice(2, 4)),
      'the original belongs in the two-level shard built from its uuid',
    );
    assert.deepEqual(readFileSync(originalPath), assetBytes, 'stored bytes must be identical');
    assert.equal(statSync(originalPath).size, assetBytes.length);
    ok(`original written to ${relative(mediaRoot, originalPath)} and byte-identical`);

    const mtimeDelta = Math.abs(statSync(originalPath).mtimeMs - new Date(MODIFIED_AT).getTime());
    assert.ok(mtimeDelta < 1, `mtime should come from fileModifiedAt (off by ${mtimeDelta}ms)`);
    ok('mtime is set from the client-supplied fileModifiedAt, not wall clock');

    const sidecarResult = await client.query<{ path: string; type: string }>(
      'select path, type from asset_file where "assetId" = $1',
      [assetId],
    );
    assert.equal(
      sidecarResult.rows.length,
      1,
      'the sidecar part records exactly one asset_file row',
    );
    const sidecarPath = sidecarResult.rows[0].path;
    assert.equal(sidecarResult.rows[0].type, 'sidecar');
    const sidecarUuid = basename(sidecarPath).replace(/\.[^.]+$/, '');
    assert.match(sidecarUuid, UUID_PATTERN);
    assert.equal(basename(sidecarPath).slice(-4), '.xmp', 'a sidecar is always stored as .xmp');
    assert.equal(
      dirname(sidecarPath),
      join(mediaRoot, 'upload', ownerId, sidecarUuid.slice(0, 2), sidecarUuid.slice(2, 4)),
      'every part is sharded by its own generated uuid (§5.5)',
    );
    assert.deepEqual(readFileSync(sidecarPath), sidecarBytes);
    const sidecarMtimeDelta = Math.abs(
      statSync(sidecarPath).mtimeMs - new Date(MODIFIED_AT).getTime(),
    );
    assert.ok(
      sidecarMtimeDelta < 1,
      `the sidecar mtime must come from fileModifiedAt (off by ${sidecarMtimeDelta}ms)`,
    );
    ok(
      'sidecar stored as an `asset_file` row of type `sidecar`, `.xmp` on disk, mtime from fileModifiedAt',
    );

    const exifResult = await client.query<{ fileSizeInByte: string }>(
      'select "fileSizeInByte" from exif where "assetId" = $1',
      [assetId],
    );
    assert.equal(Number(exifResult.rows[0].fileSizeInByte), assetBytes.length);
    ok('exif row records the streamed byte size');

    const usageAfterFirst = await fetchQuotaUsage(client, ownerId);
    assert.equal(
      usageAfterFirst,
      assetBytes.length,
      'quota usage is billed with the asset size only (the sidecar is free)',
    );
    ok(`quota usage incremented by exactly ${assetBytes.length} bytes`);

    const filesAfterFirst = walkFiles(mediaRoot).length;
    assert.equal(filesAfterFirst, 2, 'one original plus one sidecar');

    // --- 2. the same bytes again are a duplicate, not an error -----------------
    const duplicate = await upload(baseUrl, ownerId, { bytes: assetBytes, filename: FILENAME });
    assert.equal(duplicate.status, 200, `duplicate should be 200, got ${duplicate.status}`);
    assert.deepEqual(duplicate.body, { status: 'duplicate', id: assetId });
    assert.equal(
      await countAssetsWithChecksum(client, ownerId, checksumHex),
      1,
      'a duplicate must not add a second row',
    );
    await waitForFileCount(mediaRoot, filesAfterFirst);
    ok('re-uploading identical bytes → 200 {status:duplicate} with the original id, no leftovers');

    // --- 3. the header fast path answers before the body is read ---------------
    const headerDuplicate = await send(baseUrl, '/api/assets', {
      method: 'POST',
      headers: { 'x-user-id': ownerId, [CHECKSUM_HEADER]: checksumHex },
    });
    assert.equal(headerDuplicate.status, 200);
    assert.deepEqual(headerDuplicate.body, { status: 'duplicate', id: assetId });
    ok('x-immich-checksum hit answers 200 duplicate without parsing a body');

    const base64Duplicate = await send(baseUrl, '/api/assets', {
      method: 'POST',
      headers: { 'x-user-id': ownerId, [CHECKSUM_HEADER]: sha1Base64(assetBytes) },
    });
    assert.equal(base64Duplicate.status, 200);
    assert.deepEqual(base64Duplicate.body, { status: 'duplicate', id: assetId });
    ok('a base64-encoded checksum decodes to the same digest');

    // --- 4. the batch pre-check ------------------------------------------------
    const bulk = await bulkUploadCheck(baseUrl, ownerId, [
      { id: 'hex', checksum: checksumHex },
      { id: 'base64', checksum: sha1Base64(assetBytes) },
      { id: 'fresh', checksum: otherChecksumHex },
    ]);
    assert.equal(bulk.status, 200);
    const results = asRecord(bulk.body).results as BulkResult[];
    assert.equal(results.length, 3);
    assert.deepEqual(results[0], {
      id: 'hex',
      action: 'reject',
      reason: 'duplicate',
      assetId,
      isTrashed: false,
    });
    assert.deepEqual(results[1], {
      id: 'base64',
      action: 'reject',
      reason: 'duplicate',
      assetId,
      isTrashed: false,
    });
    assert.deepEqual(results[2], { id: 'fresh', action: 'accept' });
    ok('bulk-upload-check rejects known bytes (hex + base64) and accepts unknown ones');

    const empty = await bulkUploadCheck(baseUrl, ownerId, []);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body, { results: [] });
    ok('bulk-upload-check returns an empty result set for an empty batch');

    // --- 5. a second, distinct upload is billed too ----------------------------
    const second = await upload(baseUrl, ownerId, { bytes: otherBytes, filename: 'other.jpg' });
    assert.equal(second.status, 201);
    assert.equal((second.body as { status: string }).status, 'created');
    assert.equal(
      await fetchQuotaUsage(client, ownerId),
      assetBytes.length + otherBytes.length,
      'each upload adds its own size to the running total',
    );
    ok('a second upload is created and billed independently');

    const filesAfterSecond = walkFiles(mediaRoot).length;
    assert.equal(filesAfterSecond, 3, 'two originals plus one sidecar');

    // --- 6. an empty part is rejected and leaves nothing behind ---------------
    const emptyUpload = await upload(baseUrl, ownerId, {
      bytes: Buffer.alloc(0),
      filename: 'empty.jpg',
    });
    assert.equal(emptyUpload.status, 400);
    const emptyBody = asRecord(emptyUpload.body);
    assert.equal(emptyBody.statusCode, 400);
    assert.equal(emptyBody.message, 'File is empty');
    await waitForFileCount(mediaRoot, filesAfterSecond);
    ok('POST with a zero-byte assetData → 400 `File is empty`, no file left on disk');

    // --- 7. an unsupported extension is refused before anything is written -----
    const unsupported = await upload(baseUrl, ownerId, {
      bytes: Buffer.from(`immich-e2e-notes-${runId}`),
      filename: 'notes.txt',
    });
    assert.equal(unsupported.status, 400);
    const unsupportedBody = asRecord(unsupported.body);
    assert.equal(unsupportedBody.statusCode, 400);
    assert.equal(unsupportedBody.message, 'Unsupported file type notes.txt');
    await waitForFileCount(mediaRoot, filesAfterSecond);
    ok('unsupported extension → 400 `Unsupported file type notes.txt`, nothing persisted');

    // --- 8. quota is enforced before persisting -------------------------------
    const usageBeforeQuota = await fetchQuotaUsage(client, ownerId);
    await setQuota(client, ownerId, usageBeforeQuota + 1);

    const overQuota = await upload(baseUrl, ownerId, {
      bytes: otherBytes,
      filename: 'over-quota.jpg',
    });
    assert.equal(overQuota.status, 400, JSON.stringify(overQuota.body));
    const overQuotaBody = asRecord(overQuota.body);
    assert.equal(overQuotaBody.statusCode, 400);
    assert.equal(overQuotaBody.message, 'Quota has been exceeded!');
    assert.equal(
      await fetchQuotaUsage(client, ownerId),
      usageBeforeQuota,
      'a rejected upload must not be billed',
    );
    await waitForFileCount(mediaRoot, filesAfterSecond);
    ok(
      'over-quota upload → 400 `Quota has been exceeded!` with no row, no charge, no leftover file',
    );

    assert.equal(
      await countAssetsWithChecksum(client, ownerId, otherChecksumHex),
      1,
      'the quota rejection followed an existing asset with the same bytes, so the count stays 1',
    );

    console.log(`\nupload e2e passed (${checks} checks)`);
  } catch (error) {
    console.error('\n--- server output ---');
    console.error(handle.output());
    console.error('--- end server output ---');
    throw error;
  } finally {
    await stopServer(handle);
    rmSync(mediaRoot, { recursive: true, force: true });

    if (ownerId) {
      // Deleting the user cascades to its assets, asset_file, exif and
      // asset_metadata rows.
      await client
        .query('delete from users where id = $1', [ownerId])
        .catch((error: unknown) => console.error(`cleanup failed: ${describe(error)}`));
    }

    await client.end().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(`\nupload e2e failed: ${describe(error)}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }

  process.exitCode = 1;
});
