import type { ColumnType, Generated } from 'kysely';

/**
 * `ColumnType<Select, Insert, Update>` for timestamp columns, matching
 * `user.table.ts`. `NullableTimestamp` is the same idea for columns that may be
 * SQL `NULL` (e.g. `deletedAt`).
 */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

/**
 * A stored original. `checksum` is the SHA-1 computed while streaming the file
 * to disk, and `(ownerId, checksum)` carries the `ASSET_CHECKSUM_CONSTRAINT`
 * unique index that is the authoritative duplicate defense (brief §2, §6).
 *
 * `deletedAt` backs the `isTrashed` flag surfaced by `bulkUploadCheck`.
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
  deletedAt: NullableTimestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
