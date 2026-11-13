import { Inject, Injectable } from '@nestjs/common';
import {
  APP_VERSION_HEADER,
  CLIENT_HEADER,
  Platform,
  RUNTIME_KEY_TTL_SECONDS,
  runtimeKey,
} from '@wayfare/contracts';
import { consentStateProto } from '@wayfare/contracts/grpc';
import { deviceIdOf } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import {
  ANALYTICS_CALLER,
  AnalyticsServiceGrpcClient,
} from '../analytics-client/analytics-service-grpc.client';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { REDIS } from '../ops/redis.module';
import type {
  AnalyticsConsentDto,
  AnalyticsEventsDto,
  TelemetryActivityDto,
} from './dto/analytics.dto';
import type { AnalyticsEventsResponseDto } from './dto/analytics-response.dto';

/** How long the live Areas are trusted before catalog is asked again. */
const AREAS_TTL_MS = 5 * 60_000;

/** A build the version header doesn't name — the web, or a header missing. */
const UNKNOWN_VERSION = '0.0.0';

/**
 * The tourist's analytics routes (api-endpoints-plan §7). The writes reach analytics with an
 * anonymous caller; the analytics id is used here only as the rate-limit key (ADR 0042).
 */
@Injectable()
export class AnalyticsService {
  private areas: { ids: ReadonlySet<string>; until: number } | null = null;

  constructor(
    private readonly analytics: AnalyticsServiceGrpcClient,
    private readonly catalog: CatalogServiceGrpcClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async consent(body: AnalyticsConsentDto): Promise<void> {
    await this.analytics.events.call(
      'recordConsent',
      {
        analyticsDeviceId: body.analyticsDeviceId,
        state: consentStateProto.toProto(body.state),
        policyVersion: body.policyVersion,
      },
      ANALYTICS_CALLER,
    );
  }

  /**
   * Forwards a batch with the install's platform and build — read from the client's headers,
   * nothing that identifies. Each event goes as it was sent; analytics checks it.
   */
  events(request: Request, body: AnalyticsEventsDto): Promise<AnalyticsEventsResponseDto> {
    const version = request.header(APP_VERSION_HEADER)?.trim();
    return this.analytics.events.call(
      'ingestEvents',
      {
        analyticsDeviceId: body.analyticsDeviceId,
        eventsJson: body.events.map((event) => JSON.stringify(event)),
        platform: request.header(CLIENT_HEADER) === 'web' ? Platform.WEB : Platform.ANDROID,
        appVersion:
          version === undefined || version === '' ? UNKNOWN_VERSION : version.slice(0, 32),
      },
      ANALYTICS_CALLER,
    );
  }

  /**
   * The consent-free lane: the caller's install added to its Area's counter for this UTC
   * hour, nothing else stored. An Area the gateway doesn't serve isn't counted.
   */
  async activity(context: RequestContext, body: TelemetryActivityDto, now = new Date()) {
    const deviceId = deviceIdOf(context);
    if (deviceId === null || !(await this.liveAreas(context)).has(body.areaId)) return;
    const key = runtimeKey(body.areaId, now);
    await this.redis.multi().pfadd(key, deviceId).expire(key, RUNTIME_KEY_TTL_SECONDS).exec();
  }

  /** The live Areas `/areas` serves, remembered for a few minutes. */
  private async liveAreas(context: RequestContext): Promise<ReadonlySet<string>> {
    const now = Date.now();
    if (this.areas !== null && this.areas.until > now) return this.areas.ids;
    const { areas } = await this.catalog.placeQueries.call('listAreas', {}, context);
    this.areas = { ids: new Set(areas.map((area) => area.id)), until: now + AREAS_TTL_MS };
    return this.areas.ids;
  }
}
