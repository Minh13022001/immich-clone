import { ApiError } from '@immich/sdk';

/**
 * The upload transport (spec §8.1).
 *
 * `fetch` cannot report *upload* progress and cannot be aborted mid-body in the
 * same way, so the bytes go through `XMLHttpRequest` — the only API that exposes
 * `upload.onprogress` and a synchronous `abort()`. Every in-flight request is
 * registered here, which is what lets the manager cancel them all when the
 * session ends.
 *
 * Requests go to an **absolute** URL now: the body is written straight to the
 * object store through a presigned URL, not to this API.
 */

export interface UploadProgress {
  loaded: number;
  total: number;
}

export interface PresignedUploadOptions {
  /** Always `PUT` for S3 presigned URLs; kept explicit for clarity. */
  method?: 'PUT';
  /**
   * Headers the server signed into the URL. They must be sent verbatim, or the
   * store rejects the request.
   */
  headers?: Record<string, string>;
  /** Called repeatedly with cumulative bytes sent for this request. */
  onProgress?: (progress: UploadProgress) => void;
  /** Aborting the signal aborts the request. */
  signal?: AbortSignal;
}

export interface PresignedUploadResult {
  status: number;
  /**
   * ETag of the stored object/part, when the bucket exposes it through CORS.
   *
   * Only a convenience: the server re-reads the authoritative part listing, so a
   * missing ETag costs nothing but an omitted advisory list.
   */
  etag?: string;
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
 * PUTs raw bytes at a presigned URL, reporting progress as it goes.
 *
 * Resolves for any 2xx; anything else rejects with an `ApiError` carrying the
 * store's own message (S3 answers with a small XML document, which is far more
 * useful than a bare status code when a signature or checksum is wrong).
 */
export function putToPresignedUrl(
  url: string,
  body: Blob,
  options: PresignedUploadOptions = {},
): Promise<PresignedUploadResult> {
  return new Promise<PresignedUploadResult>((resolve, reject) => {
    const request = new XMLHttpRequest();
    inFlight.add(request);

    const onSignalAbort = () => {
      request.abort();
    };

    const settle = () => {
      inFlight.delete(request);
      options.signal?.removeEventListener('abort', onSignalAbort);
    };

    request.open(options.method ?? 'PUT', url);
    // The body is opaque to us; asking XHR to parse it would throw on S3's
    // occasional empty 200 and buys nothing.
    request.responseType = 'text';

    for (const [name, value] of Object.entries(options.headers ?? {})) {
      request.setRequestHeader(name, value);
    }

    request.upload.addEventListener('progress', (event) => {
      // `total` is 0 when the browser cannot determine the body length; the
      // store treats that as "unknown" rather than dividing by zero.
      options.onProgress?.({ loaded: event.loaded, total: event.total });
    });

    request.addEventListener('load', () => {
      settle();

      if (request.status >= 200 && request.status < 300) {
        resolve({
          status: request.status,
          etag: request.getResponseHeader('etag') ?? undefined,
        });
        return;
      }

      reject(
        new ApiError(
          request.status,
          `${request.status} ${request.statusText}`,
          request.responseText || undefined,
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

    request.send(body);
  });
}
