import { getBaseUrl } from '@immich/sdk';

/**
 * Event names the server streams over SSE (mirrors the server's
 * `ServerEventName`, which in turn mirrors the reference's websocket events).
 */
export type ServerEventName =
  'on_upload_success' | 'AssetUploadReadyV2' | 'AssetCreate' | 'AlbumUpdate';

export type ServerEventHandler = (data: unknown) => void;

/**
 * Opens the server's event stream (spec §8.6; the websocket replacement, D6).
 *
 * `EventSource` cannot send headers, which is fine here: the auth shim (D1)
 * falls back to the seeded default user for header-less requests, exactly as the
 * header-less `POST /assets` does. EventSource reconnects on its own; the
 * returned function unsubscribes and closes the stream.
 */
export function subscribeToServerEvents(
  handlers: Partial<Record<ServerEventName, ServerEventHandler>>,
): () => void {
  const source = new EventSource(`${getBaseUrl()}/events`);
  const listeners: Array<[ServerEventName, EventListener]> = [];

  for (const [name, handler] of Object.entries(handlers)) {
    if (!handler) {
      continue;
    }

    const eventName = name as ServerEventName;
    const listener: EventListener = (event) => {
      handler(parseMessage((event as MessageEvent<string>).data));
    };

    source.addEventListener(eventName, listener);
    listeners.push([eventName, listener]);
  }

  return () => {
    for (const [eventName, listener] of listeners) {
      source.removeEventListener(eventName, listener);
    }

    source.close();
  };
}

/** Nest serializes the payload as a JSON string; tolerate anything else. */
function parseMessage(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}
