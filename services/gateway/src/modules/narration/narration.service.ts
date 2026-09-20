import { Injectable, StreamableFile } from '@nestjs/common';
import type { HotsetResponse, PrefetchResponse, RequestedLanguage } from '@wayfare/contracts';
import type { RequestContext } from '@wayfare/nest-common';
import { NarrationServiceGrpcClient } from '../narration-client/narration-service-grpc.client';
import type { NarrationStatusResponseDto, OnDemandAnswer } from './dto/narration-response.dto';
import type { HotsetDto, OnDemandDto, PrefetchDto, StreamQueryDto } from './dto/narration.dto';
import { toNarrationStatusResponseDto, toOnDemandAnswer } from './narration.mapper';

/**
 * A live stream is a speech call, not a database read: it gets the time one takes, and narration's
 * own budget is shorter still, so the service answers before this deadline passes.
 */
export const STREAM_DEADLINE_MS = 30_000;

/** `/narration/*` for tourist devices, backed by `narration.NarrationService`. */
@Injectable()
export class NarrationService {
  constructor(private readonly narration: NarrationServiceGrpcClient) {}

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
    const response = await this.narration.ttsStream.call(
      'getStreamAudio',
      { placeId: query.placeId, lang: query.lang.tag },
      context,
      { deadlineMs: STREAM_DEADLINE_MS },
    );
    return new StreamableFile(Buffer.from(response.audio), {
      type: response.contentType,
      disposition: 'inline',
    });
  }
}
