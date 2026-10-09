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
  console.log('[hashFile] entered for', file.name);

  return new Promise<string>((resolve, reject) => {
    // Vite only recognises (and bundles) a Worker when the script URL is built
    // against `import.meta.url`. Without it, `../workers/...` is resolved against
    // the page (document.baseURI), the request 404s, and hashing silently fails.
    const worker = new Worker(new URL('../workers/hash-file.worker.ts', import.meta.url), {
      type: 'module',
    });
    console.log(worker, 'worker 11');
    const stop = () => {
      worker.terminate();
    };

    worker.addEventListener('message', (event: MessageEvent<HashWorkerResponse>) => { // this is listen to the messages send from hash-file-worker.ts
      console.log(event, "event 11");
      stop();

      const { result, error } = event.data;
      console.log(result, error, "result 11");
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

    worker.postMessage(file); //give it a file to work on.
  });

  
}
// so "new Worker" is a way to make a new worker.
// "new URL('../workers/hash-file.worker.ts'" 