import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { API_PREFIX, LOCAL_OBJECT_ROOT, LOCAL_UPLOAD_ROUTE } from '../constants';
import type { StoredUploadPart } from '../schema/tables/asset-upload.table';
import { readEnv } from '../utils/config';
import { isSafeObjectKey } from '../utils/storage-keys';
import type { Env } from '../validation';

/** Where the bytes live. Mirrors `asset.storageBackend`. */
export type StorageBackend = 'local' | 's3';

export interface PresignedUpload {
  url: string;
  method: 'PUT';
  /** Headers the client must send verbatim; they are part of the signature. */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface ObjectHead {
  size: number;
  contentType?: string;
  /** Hex SHA-1 reported by S3 for a single-part upload, when present. */
  checksumSha1Hex?: string;
}

export interface ObjectStream {
  stream: Readable;
  /** Bytes in this response (i.e. the requested range, not the object). */
  size: number;
  contentRange?: string;
}

export interface ObjectRange {
  start: number;
  /** Inclusive, per the HTTP/S3 convention. */
  end?: number;
}

/**
 * What a local "presigned" URL authorises.
 *
 * The content type and the SHA-1 are inside the signed payload for the same
 * reason S3 signs them: the sink must be able to reject a body that differs from
 * what the initiator declared, without trusting a single request header.
 */
interface LocalUploadToken {
  key: string;
  size: number;
  contentType: string;
  checksumSha1Hex: string;
  expiresAt: number;
}

/**
 * The single seam for object storage.
 *
 * Two backends share one interface:
 * - `s3` — presigned URLs signed for a browser-reachable endpoint, `HeadObject`
 *   for verification, `GetObject` for reads, real multipart for large files.
 * - `local` — the same flow with the filesystem as the "bucket". The presigned
 *   URL points back at this API with an HMAC-signed token, so the browser flow
 *   (and the tests) are identical without needing MinIO. Multipart is not
 *   emulated; the local backend simply never crosses the multipart threshold.
 *
 * Nothing here decides HTTP status codes or business rules — that is the service.
 */
@Injectable()
export class ObjectStorageRepository {
  private readonly logger = new Logger(ObjectStorageRepository.name);
  private readonly env: Env;
  private readonly backend: StorageBackend;
  private readonly bucket: string;
  private readonly localRoot: string;
  private readonly s3?: S3Client;
  private readonly signer?: S3Client;

  constructor(config: ConfigService<Env, true>) {
    this.env = readEnv(config);
    this.backend = this.env.STORAGE_BACKEND;
    this.bucket = this.env.S3_BUCKET;
    this.localRoot = join(resolve(this.env.MEDIA_ROOT), LOCAL_OBJECT_ROOT);

    if (this.backend === 's3') {
      const common = {
        region: this.env.S3_REGION,
        forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
        credentials: {
          accessKeyId: this.env.S3_ACCESS_KEY_ID ?? '',
          secretAccessKey: this.env.S3_SECRET_ACCESS_KEY ?? '',
        },
      };

      this.s3 = new S3Client({ ...common, endpoint: this.env.S3_ENDPOINT || undefined });
      // Signing happens against the *public* endpoint: the signature covers the
      // Host header, so a URL signed for `minio:9000` is invalid in a browser
      // talking to `localhost:9000`.
      this.signer = new S3Client({
        ...common,
        endpoint: this.env.S3_PUBLIC_ENDPOINT || this.env.S3_ENDPOINT || undefined,
      });
    }
  }

  getBackend(): StorageBackend {
    return this.backend;
  }

  getBucket(): string {
    return this.bucket;
  }

  /** Multipart is an S3-only capability in this implementation. */
  supportsMultipart(): boolean {
    return this.backend === 's3';
  }

  getMultipartThreshold(): number {
    return this.env.MULTIPART_THRESHOLD;
  }

  getPartSize(): number {
    return this.env.PART_SIZE;
  }

  getMaxUploadSize(): number {
    return this.env.MAX_UPLOAD_SIZE;
  }

  getPresignTtlSeconds(): number {
    return this.env.PRESIGN_TTL_SECONDS;
  }

  getSessionTtlSeconds(): number {
    return this.env.UPLOAD_SESSION_TTL_SECONDS;
  }

  /**
   * Issues the URL the browser will PUT the bytes to.
   *
   * On S3 the length, content type and SHA-1 are all part of the signature, so
   * S3 itself rejects a truncated, re-typed or substituted body. On the local
   * backend the same three values are inside the signed token.
   */
  async presignPut(input: {
    key: string;
    size: number;
    contentType: string;
    checksumSha1Hex: string;
  }): Promise<PresignedUpload> {
    const expiresAt = new Date(Date.now() + this.env.PRESIGN_TTL_SECONDS * 1000);
    const digest = sha1Digest(input.checksumSha1Hex);

    if (this.backend === 'local') {
      const token = this.signLocalToken({
        key: input.key,
        size: input.size,
        contentType: input.contentType,
        checksumSha1Hex: input.checksumSha1Hex,
        expiresAt: expiresAt.getTime(),
      });

      return {
        url: `${this.env.PUBLIC_API_URL.replace(/\/+$/, '')}/${API_PREFIX}/${LOCAL_UPLOAD_ROUTE}/${token}`,
        method: 'PUT',
        // Identical to the S3 header set so the browser code has one path.
        headers: {
          'content-type': input.contentType,
          'x-amz-checksum-sha1': digest.toString('base64'),
        },
        expiresAt: expiresAt.toISOString(),
      };
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentLength: input.size,
      ContentType: input.contentType,
      ChecksumSHA1: digest.toString('base64'),
    });

    const url = await getSignedUrl(this.signer!, command, {
      expiresIn: this.env.PRESIGN_TTL_SECONDS,
    });

    return {
      url,
      method: 'PUT',
      headers: {
        'content-type': input.contentType,
        // Must be sent verbatim: S3 compares it with the digest it computes.
        'x-amz-checksum-sha1': digest.toString('base64'),
      },
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** `null` when the object does not exist yet (nothing uploaded, or swept). */
  async head(key: string): Promise<ObjectHead | null> {
    if (this.backend === 'local') {
      let path: string;

      try {
        path = this.localPath(key);
      } catch (error) {
        // A key that cannot be mapped onto the root is not an object we can
        // serve. Log it instead of masking it as "not found" *and* instead of
        // crashing every caller that treats `null` as "missing".
        this.logger.warn(`Ignoring unusable object key ${key}: ${String(error)}`);
        return null;
      }

      try {
        const info = await stat(path);
        // A directory that happens to share the key is not a stored object.
        return info.isFile() ? { size: info.size } : null;
      } catch (error) {
        // Only "absent" means absent: an EACCES/EIO must not look like a
        // deleted object, or a transient failure reads as data loss.
        if (isMissingFile(error)) {
          return null;
        }

        throw error;
      }
    }

    try {
      const output = await this.s3!.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));

      return {
        size: output.ContentLength ?? 0,
        contentType: output.ContentType,
        checksumSha1Hex: output.ChecksumSHA1
          ? Buffer.from(output.ChecksumSHA1, 'base64').toString('hex')
          : undefined,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Authoritative SHA-1 of the stored bytes.
   *
   * Used whenever S3 cannot prove the whole-file digest itself: the local
   * backend, and every multipart upload (S3's multipart checksum is a composite
   * of part digests, which is not comparable with the client's whole-file SHA-1).
   */
  async hashObject(key: string): Promise<string> {
    const { stream } = await this.getStream(key);
    const hash = createHash('sha1');

    try {
      for await (const chunk of stream) {
        hash.update(chunk as Buffer);
      }
    } finally {
      // Releases the socket on an early failure; a forgotten S3 body leaks the
      // connection until the agent times it out.
      stream.destroy();
    }

    return hash.digest('hex');
  }

  async getStream(key: string, range?: ObjectRange): Promise<ObjectStream> {
    if (this.backend === 'local') {
      const path = this.localPath(key);
      const info = await stat(path);
      const total = info.size;

      // An unsatisfiable window (empty object, or a start at/after EOF) must not
      // reach `createReadStream`, which rejects with `ERR_OUT_OF_RANGE` from the
      // stream rather than from this call. Serving the whole entity is what the
      // S3 backend does with a clamped range, so both backends answer alike.
      const slice = range && total > 0 && range.start < total ? range : undefined;

      if (!slice) {
        return { stream: createReadStream(path), size: total };
      }

      const end = Math.min(slice.end ?? total - 1, total - 1);

      return {
        stream: createReadStream(path, { start: slice.start, end }),
        size: end - slice.start + 1,
        contentRange: `bytes ${slice.start}-${end}/${total}`,
      };
    }

    const rangeHeader = range
      ? `bytes=${range.start}-${range.end === undefined ? '' : range.end}`
      : undefined;

    const output = await this.s3!.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: rangeHeader }),
    );

    return {
      stream: output.Body as Readable,
      size: output.ContentLength ?? 0,
      contentRange: output.ContentRange,
    };
  }

  /** Writes a server-generated object (thumbnails, encoded video, raw bodies). */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.backend === 'local') {
      const path = this.localPath(key);
      await mkdir(dirname(path), { recursive: true });
      await pipeline(Readable.from(body), createWriteStream(path));
      return;
    }

    await this.s3!.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async deleteObjects(keys: (string | undefined | null)[]): Promise<void> {
    const present = keys.filter((key): key is string => Boolean(key));

    if (present.length === 0) {
      return;
    }

    if (this.backend === 'local') {
      await Promise.all(
        present.map(async (key) => {
          try {
            await rm(this.localPath(key), { force: true });
          } catch (error) {
            this.logger.warn(`Failed to delete local object ${key}: ${String(error)}`);
          }
        }),
      );
      return;
    }

    // `DeleteObjects` accepts at most 1000 keys per call.
    for (let index = 0; index < present.length; index += 1000) {
      const chunk = present.slice(index, index + 1000);
      const output = await this.s3!.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }),
      );

      // `Quiet` suppresses successful deletes but *not* failures: a 200 can
      // still carry per-key errors, and ignoring them leaks orphaned objects.
      for (const failure of output.Errors ?? []) {
        this.logger.warn(
          `Failed to delete object ${failure.Key} from ${this.bucket}: ${failure.Code ?? 'unknown error'}`,
        );
      }
    }
  }

  // --- multipart (S3 only) ------------------------------------------------

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    this.assertMultipartSupported();
    const output = await this.s3!.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );

    if (!output.UploadId) {
      throw new Error('S3 did not return a multipart upload id');
    }

    return output.UploadId;
  }

  async presignPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    /**
     * Optional per-part digest. When the client supplies one S3 enforces it;
     * when it does not, integrity is still guaranteed by the whole-file re-hash
     * that runs before any asset row is created.
     */
    checksumSha1Hex?: string;
  }): Promise<PresignedUpload> {
    this.assertMultipartSupported();
    const expiresAt = new Date(Date.now() + this.env.PRESIGN_TTL_SECONDS * 1000);
    const digest = input.checksumSha1Hex ? sha1Digest(input.checksumSha1Hex) : undefined;

    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: input.key,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
      ChecksumSHA1: digest?.toString('base64'),
    });

    const url = await getSignedUrl(this.signer!, command, {
      expiresIn: this.env.PRESIGN_TTL_SECONDS,
    });

    return {
      url,
      method: 'PUT',
      // Part size and content length are not signed (they depend on the file
      // split); the digest is when supplied, and the final object is always
      // re-hashed server-side.
      headers: digest ? { 'x-amz-checksum-sha1': digest.toString('base64') } : {},
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Authoritative part list from S3.
   *
   * Client-supplied ETags are only used to *drive* `CompleteMultipartUpload`;
   * what we persist and verify comes from here.
   */
  async listParts(key: string, uploadId: string): Promise<StoredUploadPart[]> {
    this.assertMultipartSupported();
    const parts: StoredUploadPart[] = [];
    let marker: string | undefined;

    do {
      const output = await this.s3!.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );

      for (const part of output.Parts ?? []) {
        if (part.PartNumber === undefined || !part.ETag) {
          continue;
        }

        parts.push({ partNumber: part.PartNumber, etag: part.ETag, size: part.Size ?? 0 });
      }

      marker = output.IsTruncated ? output.NextPartNumberMarker : undefined;
    } while (marker);

    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: StoredUploadPart[],
  ): Promise<void> {
    this.assertMultipartSupported();
    await this.s3!.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({ ETag: part.etag, PartNumber: part.partNumber })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    if (!this.supportsMultipart()) {
      return;
    }

    try {
      await this.s3!.send(
        new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
      );
    } catch (error) {
      // Aborting twice is not an error; anything else is worth a log but must
      // never fail the caller's cleanup path.
      if (!isNotFound(error) && !isNoSuchUpload(error)) {
        this.logger.warn(`Failed to abort multipart upload ${uploadId}: ${String(error)}`);
      }
    }
  }

  // --- local backend helpers ---------------------------------------------

  /** Verifies a local upload token and returns what it authorises. */
  verifyLocalToken(token: string): LocalUploadToken {
    const [body, signature] = token.split('.');

    if (!body || !signature) {
      throw new UnauthorizedException('Invalid upload token');
    }

    const expected = createHmac('sha256', this.env.UPLOAD_TOKEN_SECRET)
      .update(body)
      .digest('base64url');
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid upload token');
    }

    // Parsing happens after the signature check, so a malformed body means the
    // secret changed under a live URL: that is a 401, never an uncaught
    // `SyntaxError` surfacing as a 500.
    const payload = parseLocalToken(body);

    if (!payload) {
      throw new UnauthorizedException('Invalid upload token');
    }

    if (payload.expiresAt <= Date.now()) {
      throw new UnauthorizedException('Upload token expired');
    }

    if (!isSafeObjectKey(payload.key)) {
      throw new UnauthorizedException('Invalid upload key');
    }

    return payload;
  }

  /**
   * Streams a local "PUT" to disk, enforcing the signed byte budget and digest.
   *
   * This is the local equivalent of S3 rejecting a body whose length or
   * `x-amz-checksum-sha1` does not match the signature: the file is hashed as it
   * is written and removed again if either check fails, so a rejected upload
   * never leaves a partial object behind.
   */
  async writeLocalObject(
    key: string,
    source: Readable,
    expected: { size: number; checksumSha1Hex: string },
  ): Promise<number> {
    // Refuse before touching the disk. A token without a sane budget or a real
    // digest would otherwise authorise a zero-byte overwrite that "matches" as
    // soon as `expected.size` is 0 and the digest empty.
    if (!Number.isSafeInteger(expected.size) || expected.size < 0) {
      throw new Error('Refusing to write an object without an authorised size');
    }

    if (!SHA1_HEX.test(expected.checksumSha1Hex)) {
      throw new Error('Refusing to write an object without an authorised checksum');
    }

    const path = this.localPath(key);
    await mkdir(dirname(path), { recursive: true });

    const hash = createHash('sha1');
    let written = 0;

    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            written += chunk.length;

            if (written > expected.size) {
              throw new Error('Uploaded body exceeds the authorised size');
            }

            hash.update(chunk);
            yield chunk;
          }
        },
        createWriteStream(path),
      );

      if (written !== expected.size) {
        throw new Error('Uploaded body is shorter than the authorised size');
      }

      // Hex is case-insensitive; comparing raw strings turned a valid digest
      // written in upper case into a spurious mismatch.
      if (hash.digest('hex') !== expected.checksumSha1Hex.toLowerCase()) {
        throw new Error('Uploaded body does not match the authorised checksum');
      }
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }

    return written;
  }

  /** Absolute path for a key, refusing anything that escapes the object root. */
  localPath(key: string): string {
    if (!isSafeObjectKey(key)) {
      throw new Error(`Unsafe object key: ${key}`);
    }

    const path = resolve(this.localRoot, key);
    const root = resolve(this.localRoot);

    if (path !== root && !path.startsWith(`${root}/`)) {
      throw new Error(`Object key escapes the storage root: ${key}`);
    }

    return path;
  }

  // --- internals ----------------------------------------------------------

  private signLocalToken(payload: LocalUploadToken): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.env.UPLOAD_TOKEN_SECRET)
      .update(body)
      .digest('base64url');

    return `${body}.${signature}`;
  }

  private assertMultipartSupported(): void {
    if (!this.supportsMultipart()) {
      throw new Error('Multipart uploads require STORAGE_BACKEND=s3');
    }
  }
}

/** 40 hex characters: the only digest shape the protocol accepts. */
const SHA1_HEX = /^[0-9a-f]{40}$/i;

/** `HeadObject`/`GetObject` report a missing key as 404 rather than throwing a type. */
function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate?.$metadata?.httpStatusCode === 404 || candidate?.name === 'NotFound';
}

/** `stat` reports an absent path as `ENOENT` (or `ENOTDIR` for a bad parent). */
function isMissingFile(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Decodes a SHA-1 hex digest.
 *
 * `Buffer.from(hex, 'hex')` silently truncates at the first invalid byte, which
 * would sign (and accept) a *shorter* digest than the client declared.
 */
function sha1Digest(hex: string): Buffer {
  if (!SHA1_HEX.test(hex)) {
    throw new Error(`Expected a 40-character SHA-1 hex digest, received "${hex}"`);
  }

  return Buffer.from(hex, 'hex');
}

/**
 * Parses a signed token body, returning `null` when it is not a valid payload.
 *
 * The signature guarantees integrity, not shape: a secret rotation or a bug in
 * the signer must not let a bad object reach `writeLocalObject`.
 */
function parseLocalToken(body: string): LocalUploadToken | null {
  let value: unknown;

  try {
    value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const candidate = value as Partial<LocalUploadToken> | null;

  if (
    typeof candidate?.key !== 'string' ||
    typeof candidate.size !== 'number' ||
    !Number.isSafeInteger(candidate.size) ||
    candidate.size < 0 ||
    typeof candidate.contentType !== 'string' ||
    candidate.contentType.length === 0 ||
    typeof candidate.checksumSha1Hex !== 'string' ||
    !SHA1_HEX.test(candidate.checksumSha1Hex) ||
    typeof candidate.expiresAt !== 'number' ||
    !Number.isFinite(candidate.expiresAt)
  ) {
    return null;
  }

  return {
    key: candidate.key,
    size: candidate.size,
    contentType: candidate.contentType,
    checksumSha1Hex: candidate.checksumSha1Hex.toLowerCase(),
    expiresAt: candidate.expiresAt,
  };
}

function isNoSuchUpload(error: unknown): boolean {
  const candidate = error as { name?: string };
  return candidate?.name === 'NoSuchUpload';
}
