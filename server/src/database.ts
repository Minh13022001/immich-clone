/**
 * Domain types.
 *
 * The reference project separates "what the API talks about" (this file) from
 * "what the tables look like" (`schema/`). Repositories translate between the
 * two. Keeping the domain type free of Kysely column wrappers means services
 * and controllers never see database-only concepts such as `Generated<T>`.
 */

export interface Photo {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
