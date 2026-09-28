import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/**
 * One physical file belonging to an asset. Uploads create an `original` row and,
 * when a sidecar `.xmp` part is present, a `sidecar` row (brief §3.4, §5.5).
 */
export interface AssetFileTable {
  id: Generated<string>;
  assetId: string;
  path: string;
  type: string;
  createdAt: Timestamp;
}
