import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Env } from '../validation';

/**
 * Top-level folders under the media root (spec §5.5).
 *
 * `Upload` holds every original (and its optional `.xmp` sidecar) inside a
 * sharded per-user tree; `Profile` holds user avatars.
 */
export enum StorageFolder {
  Upload = 'upload',
  Profile = 'profile',
}

/** Resolves the configured media root to an absolute path. */
export function resolveMediaRoot(env: Pick<Env, 'MEDIA_ROOT'>): string {
  return resolve(env.MEDIA_ROOT);
}

/**
 * Two-level shard built from the first four characters of a UUID, e.g.
 * `3f/9a`. Keeps any single directory from growing without bound.
 */
export function getNestedShard(uuid: string): string {
  return join(uuid.slice(0, 2), uuid.slice(2, 4));
}

/**
 * Filesystem-layout helper (spec §5.5).
 *
 * Pure path computation lives here; callers decide when to create directories so
 * a quota rejection never leaves an empty folder behind.
 */
export class StorageCore {
  constructor(private readonly mediaRoot: string) {}

  static fromEnv(env: Pick<Env, 'MEDIA_ROOT'>): StorageCore {
    return new StorageCore(resolveMediaRoot(env));
  }

  getMediaRoot(): string {
    return this.mediaRoot;
  }

  /** `<mediaRoot>/upload/<userId>/<uu>/<uu>` for the given sharding uuid. */
  getNestedFolder(folder: StorageFolder, userId: string, uuid: string): string {
    return join(this.mediaRoot, folder, userId, getNestedShard(uuid));
  }

  /** `<mediaRoot>/profile/<userId>`. */
  getUserFolder(folder: StorageFolder, userId: string): string {
    return join(this.mediaRoot, folder, userId);
  }

  /** Creates `folder` (and parents) if needed and returns it. */
  ensureFolder(folder: string): string {
    mkdirSync(folder, { recursive: true });
    return folder;
  }
}

/**
 * Strips path separators and control characters from a generated filename.
 *
 * Upload filenames are built from a server-generated UUID plus a whitelisted
 * extension, but `originalFileName` is client-supplied, so the same helper
 * guards both before either touches the filesystem.
 */
export function sanitizeFilename(filename: string): string {
  return (
    filename
      .replace(/[/\\]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/^\.+/, '')
      .trim()
  );
}
