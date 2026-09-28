/**
 * Client-supplied key/value metadata (`dto.metadata`). Composite primary key on
 * `(assetId, key)` so `upsertMetadata` is a plain upsert (brief §5.4, §6).
 */
export interface AssetMetadataTable {
  assetId: string;
  key: string;
  value: string;
}
