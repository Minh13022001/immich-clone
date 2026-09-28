import type { HashWorkerResponse } from '$lib/workers/hash-file.worker';

/**
 * Hashes a file without blocking the UI (spec §8.2).
 *
 * All the work happens in [`hash-file.worker.ts`](../workers/hash-file.worker.ts);
 * this is only the message plumbing. A fresh worker per file keeps the calls
 * independent, and terminating it afterwards stops a cancelled upload from
 * leaving a worker behind.
 */
export function hashFile(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/hash-file.worker.ts', import.meta.url), {
      type: 'module',
    });

    const stop = () => {
      worker.terminate();
    };

    worker.addEventListener('message', (event: MessageEvent<HashWorkerResponse>) => {
      stop();

      const { result, error } = event.data;

      if (result === undefined) {
        reject(new Error(error ?? 'Hashing failed'));
        return;
      }

      resolve(result);
    });

    worker.addEventListener('error', (event) => {
      stop();
      reject(new Error(event.message || 'Hashing worker failed'));
    });

    worker.postMessage(file);
  });
}
