import type { ColumnType, Generated } from 'kysely';

/**
 * `ColumnType<SelectType, InsertType, UpdateType>` lets one column have three
 * different shapes: what the database returns, what you may pass on insert and
 * what you may pass on update. `createdAt`/`updatedAt` are set by Postgres, so
 * they are optional on insert.
 */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/** Shape of the `photos` table. */
export interface PhotoTable {
  id: Generated<string>;
  name: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
