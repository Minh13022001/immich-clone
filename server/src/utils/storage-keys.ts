/**
 * Object-key layout (S3) and the local equivalent.
 *
 * Keys are built exclusively on the server so a presigned URL can only ever
 * write one exact object: the client never supplies a key, a bucket or a prefix.
 *
 * ```
 * users/<ownerId>/originals/<uu>/<uu>/<assetId>.<ext>
 * users/<ownerId>/thumbnails/<uu>/<uu>/<assetId>.webp
 * users/<ownerId>/encoded-video/<uu>/<uu>/<assetId>.mp4
 * ```
 *
 * `uu` is the same two-level shard the disk layout uses, so both backends keep
 * directory sizes bounded.
 */

export type ObjectKind = 'original' | 'thumbnail' | 'encoded-video';

const KIND_SEGMENT: Record<ObjectKind, string> = {
  original: 'originals',
  thumbnail: 'thumbnails',
  'encoded-video': 'encoded-video',
};

/**
 * Two-level shard written with forward slashes.
 *
 * `utils/storage.ts#getNestedShard` uses `path.join`, which yields backslashes on
 * Windows; object keys must always be POSIX, so this is deliberately separate.
 */
export function shardFor(id: string): string {
  return `${id.slice(0, 2)}/${id.slice(2, 4)}`;
}

/** Normalises `'.JPG'` / `'JPG'` to `'jpg'`; a bare name stays extension-less. */
export function normalizeExtension(extension: string): string {
  return extension.replace(/^\./, '').toLowerCase();
}

/** Full object key for one stored file. */
export function buildObjectKey(
  kind: ObjectKind,
  ownerId: string,
  id: string,
  extension: string,
): string {
  const ext = normalizeExtension(extension);
  return `users/${ownerId}/${KIND_SEGMENT[kind]}/${shardFor(id)}/${id}${ext ? `.${ext}` : ''}`;
}

/** Prefix used when sweeping orphans of one kind for one owner. */
export function buildObjectPrefix(kind: ObjectKind, ownerId: string): string {
  return `users/${ownerId}/${KIND_SEGMENT[kind]}/`;
}

/**
 * Rejects keys that could escape the storage root when the local backend maps a
 * key onto the filesystem. Keys are server-generated, so this is defence in
 * depth rather than the primary guard.
 */
export function isSafeObjectKey(key: string): boolean {
  if (!key || key.startsWith('/') || key.includes('\\')) {
    return false;
  }

  return key.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
