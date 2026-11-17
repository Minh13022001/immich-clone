import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableString = ColumnType<string | null, string | null | undefined, string | null>;

/**
 * One physical file belonging to an asset.
 *
 * `original` is written together with the asset row. Derived artefacts (a
 * generated thumbnail, an encoded video) are written by the job pipeline with
 * their own storage coordinates so they can live next to — but independently of
 * — the original.
 *
 * `path` is retained because existing rows use it; for new rows it mirrors the
 * storage key so old readers keep working.
 */
export interface AssetFileTable {
  id: Generated<string>;
  assetId: string;
  path: string;
  type: string;
  storageBackend: Generated<string>;
  storageKey: NullableString;
  createdAt: Timestamp;
}
