/**
 * Wire types shared by every SDK consumer.
 *
 * These mirror the API's JSON, not the server's internal types: timestamps
 * arrive as ISO strings over HTTP, so the SDK does not pretend they are `Date`.
 */

export interface Photo {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerInfo {
  name: string;
  version: string;
  nodeVersion: string;
}
