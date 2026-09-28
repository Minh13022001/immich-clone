import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getNestedShard,
  resolveMediaRoot,
  sanitizeFilename,
  StorageCore,
  StorageFolder,
} from './storage';

/** Storage layout helpers (spec §10 "nested sharding, profile"). */
describe('getNestedShard', () => {
  it('builds a two-level shard from the first four uuid characters', () => {
    expect(getNestedShard('abcd1234-0000-4000-8000-000000000000')).toBe(join('ab', 'cd'));
  });
});

describe('resolveMediaRoot', () => {
  it('resolves a relative media root against the working directory', () => {
    expect(resolveMediaRoot({ MEDIA_ROOT: './data' })).toBe(resolve('./data'));
  });
});

describe('sanitizeFilename', () => {
  it('strips path separators so a name can never escape its folder', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizeFilename('..\\..\\secret.jpg')).toBe('secret.jpg');
  });

  it('removes control characters', () => {
    expect(sanitizeFilename('photo\u0000\u001f.jpg')).toBe('photo.jpg');
  });

  it('leaves an ordinary filename alone', () => {
    expect(sanitizeFilename('uuid-1234.jpg')).toBe('uuid-1234.jpg');
  });
});

describe('StorageCore', () => {
  let mediaRoot: string;

  beforeEach(() => {
    mediaRoot = mkdtempSync(join(tmpdir(), 'immich-storage-'));
  });

  afterEach(() => {
    rmSync(mediaRoot, { recursive: true, force: true });
  });

  it('shards uploads as <mediaRoot>/upload/<userId>/<uu>/<uu>', () => {
    const storage = new StorageCore(mediaRoot);

    const folder = storage.getNestedFolder(
      StorageFolder.Upload,
      'user-1',
      'abcd1234-0000-4000-8000-000000000000',
    );

    expect(folder).toBe(join(mediaRoot, 'upload', 'user-1', 'ab', 'cd'));
  });

  it('keeps profile files flat at <mediaRoot>/profile/<userId>', () => {
    const storage = new StorageCore(mediaRoot);

    expect(storage.getUserFolder(StorageFolder.Profile, 'user-1')).toBe(
      join(mediaRoot, 'profile', 'user-1'),
    );
  });

  it('creates the folder on demand and returns it', () => {
    const storage = new StorageCore(mediaRoot);
    const folder = storage.getNestedFolder(StorageFolder.Upload, 'user-1', 'abcd');

    expect(existsSync(folder)).toBe(false);

    expect(storage.ensureFolder(folder)).toBe(folder);
    expect(existsSync(folder)).toBe(true);
  });

  it('exposes the resolved media root', () => {
    expect(new StorageCore(mediaRoot).getMediaRoot()).toBe(mediaRoot);
  });

  it('derives the media root from the environment', () => {
    expect(StorageCore.fromEnv({ MEDIA_ROOT: mediaRoot }).getMediaRoot()).toBe(mediaRoot);
  });
});
