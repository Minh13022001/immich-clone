import { Controller, Get, MessageEvent, Req, Sse } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

import type { AuthenticatedRequest } from '../authentication/context';
import { EventRepository } from '../repositories/event.repository';
import { Authenticated } from '../middleware/authenticated.decorator';

/**
 * Server → client event stream (adaptation of the reference's websocket, D6).
 *
 * `GET /api/events` is a plain SSE endpoint: each `ServerEvent` addressed to the
 * caller becomes an SSE message whose `event:` is the reference's event name —
 * so `on_upload_success` and `AssetUploadReadyV2` keep the exact names the
 * frontend listens for, even though the transport changed.
 */
@Controller('events')
export class EventsController {
  constructor(private readonly eventRepository: EventRepository) {}

  @Get()
  @Authenticated()
  @Sse()
  stream(@Req() request: AuthenticatedRequest): Observable<MessageEvent> {
    return this.eventRepository
      .forUser(request.auth.user.id)
      .pipe(map((event) => ({ type: event.name, data: event.payload }) as MessageEvent));
  }
}
