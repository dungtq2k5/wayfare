import { randomBytes } from 'node:crypto';
import { Inject, Injectable, StreamableFile } from '@nestjs/common';
import { STREAM_TICKET_TTL_MS } from '@wayfare/contracts';
import type {
  HotsetResponse,
  PrefetchResponse,
  RequestedLanguage,
  StreamTicketResponse,
} from '@wayfare/contracts';
import { AppHttpException, deviceIdOf } from '@wayfare/nest-common';
import type { RequestContext, RequestOrigin } from '@wayfare/nest-common';
import { Redis } from 'ioredis';
import { REDIS } from '../ops/redis.module';
import { NarrationServiceGrpcClient } from '../narration-client/narration-service-grpc.client';
import type { NarrationStatusResponseDto, OnDemandAnswer } from './dto/narration-response.dto';
import type { HotsetDto, OnDemandDto, PrefetchDto, StreamQueryDto } from './dto/narration.dto';
import { toNarrationStatusResponseDto, toOnDemandAnswer } from './narration.mapper';

/**
 * A live stream is a speech call, not a database read: it gets the time one takes, and narration's
 * own budget is shorter still, so the service answers before this deadline passes.
 */
export const STREAM_DEADLINE_MS = 30_000;

/** Where a stream ticket waits for its one use. */
const ticketKey = (ticket: string): string => `stream-ticket:${ticket}`;

/** What a ticket opens: one device's stream of one Place in one language, until it expires. */
interface StreamTicket {
  readonly deviceId: string;
  readonly placeId: string;
  readonly lang: string;
  readonly expiresAt: number;
}

/** `/narration/*` for tourist devices, backed by `narration.NarrationService`. */
@Injectable()
export class NarrationService {
  constructor(
    private readonly narration: NarrationServiceGrpcClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onDemand(context: RequestContext, body: OnDemandDto): Promise<OnDemandAnswer> {
    const response = await this.narration.narration.call(
      'requestOnDemand',
      { placeId: body.placeId, lang: body.lang.tag },
      context,
    );
    return toOnDemandAnswer(response);
  }

  async status(
    context: RequestContext,
    placeId: string,
    lang: RequestedLanguage,
  ): Promise<NarrationStatusResponseDto> {
    const response = await this.narration.narration.call(
      'getNarrationStatus',
      { placeId, lang: lang.tag },
      context,
    );
    return toNarrationStatusResponseDto(response);
  }

  async hotset(context: RequestContext, body: HotsetDto): Promise<HotsetResponse> {
    const response = await this.narration.hotset.call(
      'hotset',
      { lat: body.lat, lng: body.lng, lang: body.lang.tag },
      context,
    );
    return {
      ready: response.ready,
      pending: response.pending,
      requiredReadyCount: response.requiredReadyCount,
    };
  }

  async prefetch(context: RequestContext, body: PrefetchDto): Promise<PrefetchResponse> {
    const response = await this.narration.hotset.call(
      'prefetch',
      { placeIds: [...body.placeIds], lang: body.lang.tag },
      context,
    );
    return { queued: response.queued, skipped: response.skipped };
  }

  /** The audio itself, unwrapped: made whole by narration, then handed to the player. */
  async stream(context: RequestContext, query: StreamQueryDto): Promise<StreamableFile> {
    return this.streamAudio(context, query.placeId, query.lang.tag);
  }

  /**
   * A ticket for one stream (api-endpoints-plan §4.1): a browser's `<audio src>` sends neither the
   * device token nor the client header, so the URL carries this instead. Random, so it cannot be
   * guessed; kept server-side, so it binds the device, the Place and the language; spent once.
   */
  async streamTicket(
    context: RequestContext,
    body: StreamQueryDto,
    now = Date.now(),
  ): Promise<StreamTicketResponse> {
    const deviceId = deviceIdOf(context);
    if (deviceId === null) throw new AppHttpException('UNAUTHENTICATED');
    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = now + STREAM_TICKET_TTL_MS;
    const value: StreamTicket = { deviceId, placeId: body.placeId, lang: body.lang.tag, expiresAt };
    await this.redis.set(ticketKey(ticket), JSON.stringify(value), 'PX', STREAM_TICKET_TTL_MS);
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** The stream a ticket opens, as its device; the ticket is spent whatever the answer. */
  async streamByTicket(
    ticket: string,
    origin: RequestOrigin,
    now = Date.now(),
  ): Promise<StreamableFile> {
    const stored = await this.redis.getdel(ticketKey(ticket));
    const value = stored === null ? null : (JSON.parse(stored) as StreamTicket);
    if (value === null || value.expiresAt <= now) throw new AppHttpException('UNAUTHENTICATED');
    return this.streamAudio(
      { kind: 'device', deviceId: value.deviceId, origin },
      value.placeId,
      value.lang,
    );
  }

  private async streamAudio(
    context: RequestContext,
    placeId: string,
    lang: string,
  ): Promise<StreamableFile> {
    const response = await this.narration.ttsStream.call(
      'getStreamAudio',
      { placeId, lang },
      context,
      { deadlineMs: STREAM_DEADLINE_MS },
    );
    return new StreamableFile(Buffer.from(response.audio), {
      type: response.contentType,
      disposition: 'inline',
    });
  }
}
