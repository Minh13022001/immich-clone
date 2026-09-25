/**
 * The one place that knows how to perform an HTTP request.
 *
 * The base URL defaults to the relative `/api`. That is what a browser needs:
 * the web app is served from a different origin in development (Vite proxies
 * `/api`) and from the same origin behind a reverse proxy in production. Node
 * consumers (the CLI) call `setBaseUrl()` once at startup.
 */
let baseUrl = '/api';

export function setBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, '');
}

export function getBaseUrl(): string {
  return baseUrl;
}

/** Thrown for any non-2xx response so callers can branch on `status`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      // Only advertise a JSON body when there is one: Nest's ValidationPipe
      // rejects an empty body sent with `content-type: application/json`.
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      `${init?.method ?? 'GET'} ${path} -> ${response.status} ${response.statusText}`,
      await readBody(response),
    );
  }

  // 204 No Content (resource deletion) has no JSON to decode.
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Never let a non-JSON error page mask the original HTTP failure.
    return text;
  }
}
