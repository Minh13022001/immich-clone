import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/**
 * EXIF row written during upload. Only `fileSizeInByte` is set here (from the
 * streamed size, `lockedPropertiesBehavior='override'`); the extraction job in
 * the reference fills the rest, which is out of scope for this clone. Its
 * existence is what gates the `AssetUploadReadyV2` event (brief §6, §7).
 */
export interface ExifTable {
  assetId: string;
  fileSizeInByte: Generated<number | null>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
