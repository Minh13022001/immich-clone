import { sha1 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createSHA1 } from 'hash-wasm';

/**
 * SHA-1 hashing off the main thread (spec §8.2).
 *
 * A multi-gigabyte video takes seconds to hash; doing that on the main thread
 * would freeze the UI. The worker reads the file in slices instead of calling
 * `arrayBuffer()` on the whole thing, so the file never has to fit in memory.
 */

/** 5 MiB: enough to keep the hasher busy, small enough to stay in cache. */
const SLICE_SIZE = 5 * 1024 * 1024;

export interface HashWorkerResponse {
  result?: string;
  error?: string;
}

async function readSlices(file: File, update: (slice: Uint8Array) => void): Promise<void> {
  for (let offset = 0; offset < file.size; offset += SLICE_SIZE) {
    const buffer = await file.slice(offset, offset + SLICE_SIZE).arrayBuffer();
    update(new Uint8Array(buffer));
  }
}

/** Preferred path: WASM is several times faster than pure JS. */
async function hashWithWasm(file: File): Promise<string> {
  const hasher = await createSHA1();
  hasher.init();

  await readSlices(file, (slice) => {
    hasher.update(slice);
  });

  return hasher.digest('hex');
}

/** Fallback for browsers that refuse to compile the WASM module. */
async function hashWithJs(file: File): Promise<string> {
  const hasher = sha1.create();

  await readSlices(file, (slice) => {
    hasher.update(slice);
  });

  return bytesToHex(hasher.digest());
}

async function handle(file: File): Promise<HashWorkerResponse> {
  try {
    try {
      return { result: await hashWithWasm(file) };
    } catch {
      return { result: await hashWithJs(file) };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Hashing failed' };
  }
}

self.addEventListener('message', (event) => {
  void handle(event.data as File).then((response) => {
    self.postMessage(response);
  });
});
