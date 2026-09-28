import { Injectable } from '@nestjs/common';
import { filter, type Observable, Subject } from 'rxjs';

/**
 * Server → client event bus (adaptation of the reference's websocket, D6).
 *
 * Events are addressed to a user id, exactly like the reference's per-user room,
 * and delivered over SSE by `EventsController`. Emitting is synchronous and can
 * never throw into a request path.
 */
export type ServerEventName =
  'on_upload_success' | 'AssetUploadReadyV2' | 'AssetCreate' | 'AlbumUpdate';

export interface ServerEvent {
  name: ServerEventName;
  userId: string;
  payload: unknown;
}

@Injectable()
export class EventRepository {
  private readonly events = new Subject<ServerEvent>();

  emit(name: ServerEventName, userId: string, payload: unknown): void {
    this.events.next({ name, userId, payload });
  }

  /** Events addressed to one user (mirrors the reference's room addressing). */
  forUser(userId: string): Observable<ServerEvent> {
    return this.events.asObservable().pipe(filter((event) => event.userId === userId));
  }
}
