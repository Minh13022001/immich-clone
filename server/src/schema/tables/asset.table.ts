import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
type NullableString = ColumnType<string | null, string | null | undefined, string | null>;

/**
 * A stored original.
 *
 * `checksum` is the SHA-1 of the stored bytes. With direct-to-S3 uploads it is
 * produced by the server during `/complete` verification — never copied from the
 * client and never derived from an S3 ETag. `(ownerId, checksum)` carries the
 * `ASSET_CHECKSUM_CONSTRAINT` unique index that is the authoritative duplicate
 * defense (brief §2, §6).
 *
 * `storageBackend`/`storageKey` describe *where* the bytes live:
 * - `local` + `storageKey = null` — legacy row written by the multer path, the
 *   locator is `originalPath` (an absolute filesystem path).
 * - `local` + `storageKey = users/...` — direct-upload row stored under
 *   `MEDIA_ROOT/objects`.
 * - `s3` + `storageKey = users/...` — object in the configured bucket.
 *
 * `originalPath` is kept for backwards compatibility and is never exposed to
 * clients as a filesystem path anymore (see `utils/asset-mapper.ts`).
 */
export interface AssetTable {
  id: Generated<string>;
  ownerId: string;
  libraryId: string | null;
  checksum: Buffer;
  checksumAlgorithm: Generated<string>;
  originalPath: string;
  originalFileName: string;
  fileCreatedAt: Timestamp;
  fileModifiedAt: Timestamp;
  localDateTime: Timestamp;
  type: string;
  isFavorite: Generated<boolean>;
  duration: number | null;
  visibility: Generated<string>;
  livePhotoVideoId: string | null;
  storageBackend: Generated<string>;
  storageKey: NullableString;
  deletedAt: NullableTimestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
