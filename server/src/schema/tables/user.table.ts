import type { ColumnType, Generated } from 'kysely';

/**
 * `ColumnType<SelectType, InsertType, UpdateType>` lets one column have three
 * different shapes: what the database returns, what you may pass on insert and
 * what you may pass on update. `createdAt`/`updatedAt` are set by Postgres, so
 * they are optional on insert.
 */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/** Shape of the `users` table. */
export interface UserTable {
  id: Generated<string>;
  name: string;
  email: string;
  /** `NULL` means "unlimited"; otherwise the upload ceiling in bytes. */
  quotaSizeInBytes: number | null;
  /** Running total of bytes uploaded, compared against `quotaSizeInBytes`. */
  quotaUsageInBytes: Generated<number>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
