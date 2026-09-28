import { ApiError, getBaseUrl } from '@immich/sdk';

/**
 * The upload transport (spec §8.1).
 *
 * `fetch` cannot report *upload* progress, so uploads go through
 * `XMLHttpRequest` — the only API that exposes `upload.onprogress` and a
 * synchronous `abort()`. Every in-flight request is registered here, which is
 * what lets the manager cancel them all when the session ends.
 */

export interface UploadProgress {
  loaded: number;
  total: number;
}

export interface UploadRequestOptions {
  /** Called repeatedly with cumulative bytes sent. */
  onProgress?: (progress: UploadProgress) => void;
  /** Aborting the signal aborts the request. */
  signal?: AbortSignal;
}

export interface UploadResponse<T> {
  data: T;
  status: number;
}

const inFlight = new Set<XMLHttpRequest>();

/** Aborts every upload still running; called on logout (spec §8.3). */
export function cancelUploadRequests(): void {
  for (const request of inFlight) {
    request.abort();
  }

  inFlight.clear();
}

/**
 * POSTs `formData` and resolves with the parsed body plus the HTTP status, so
 * the caller can tell `201 created` from `200 duplicate` (both are successes).
 * Anything outside 2xx rejects with an `ApiError` carrying the server's body.
 */
export function uploadRequest<T>(
  path: string,
  formData: FormData,
  options: UploadRequestOptions = {},
): Promise<UploadResponse<T>> {
  return new Promise<UploadResponse<T>>((resolve, reject) => {
    const request = new XMLHttpRequest();
    inFlight.add(request);

    const onSignalAbort = () => {
      request.abort();
    };

    const settle = () => {
      inFlight.delete(request);
      options.signal?.removeEventListener('abort', onSignalAbort);
    };

    request.open('POST', `${getBaseUrl()}${path}`);
    request.responseType = 'json';

    request.upload.addEventListener('progress', (event) => {
      // `total` is 0 when the browser cannot determine the body length; the
      // store treats that as "unknown" rather than dividing by zero.
      options.onProgress?.({ loaded: event.loaded, total: event.total });
    });

    request.addEventListener('load', () => {
      settle();

      if (request.status >= 200 && request.status < 300) {
        resolve({ data: request.response as T, status: request.status });
        return;
      }

      reject(
        new ApiError(
          request.status,
          `${request.status} ${request.statusText}`,
          request.response ?? undefined,
        ),
      );
    });

    request.addEventListener('error', () => {
      settle();
      reject(new ApiError(0, 'Network error while uploading'));
    });

    request.addEventListener('abort', () => {
      settle();
      reject(new DOMException('Upload aborted', 'AbortError'));
    });

    if (options.signal) {
      if (options.signal.aborted) {
        settle();
        reject(new DOMException('Upload aborted', 'AbortError'));
        return;
      }

      options.signal.addEventListener('abort', onSignalAbort);
    }

    request.send(formData);
  });
}
