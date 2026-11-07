import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  Auth,
  Ctx,
  NoStore,
  RateLimit,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import type { Request } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { AnalyticsService } from './analytics.service';
import { AnalyticsConsentDto, AnalyticsEventsDto, TelemetryActivityDto } from './dto/analytics.dto';
import { AnalyticsEventsResponseDto } from './dto/analytics-response.dto';

/**
 * `/analytics` and `/telemetry` — the tourist's consented events and the consent-free runtime lane
 * (api-endpoints-plan §7). Their bodies are never logged (ADR 0042).
 */
@ApiTags('analytics')
@UsesUpstream()
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post('analytics/consent')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('DEVICE')
  @RateLimit('ANALYTICS_CONSENT')
  @NoStore()
  @ApiOperation({
    summary:
      'A consent decision for an analytics id. A withdrawal deletes its raw events; a grant must be on the current privacy policy.',
  })
  @ApiEnvelope(null)
  @ApiErrors('LEGAL_VERSION_OUTDATED', 'UPSTREAM_UNAVAILABLE')
  async consent(@Body() body: AnalyticsConsentDto): Promise<void> {
    await this.analytics.consent(body);
  }

  @Post('analytics/events')
  @HttpCode(HttpStatus.ACCEPTED)
  @Auth('DEVICE')
  @RateLimit('ANALYTICS_INGEST')
  @NoStore()
  @ApiOperation({
    summary:
      'Up to 100 consented events. A duplicate id is dropped, as is an event that fails its own check; a coordinate anywhere refuses the batch.',
  })
  @ApiEnvelope(AnalyticsEventsResponseDto, { status: HttpStatus.ACCEPTED })
  @ApiErrors('CONSENT_REQUIRED', 'UPSTREAM_UNAVAILABLE')
  @ZodSerializerDto(AnalyticsEventsResponseDto)
  events(
    @Req() request: Request,
    @Body() body: AnalyticsEventsDto,
  ): Promise<AnalyticsEventsResponseDto> {
    return this.analytics.events(request, body);
  }

  @Post('telemetry/activity')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('DEVICE')
  @RateLimit('TELEMETRY')
  @NoStore()
  @ApiOperation({
    summary:
      'The consent-free lane: this install is active in an Area this hour. Nothing else is stored; an unknown Area is not counted.',
  })
  @ApiEnvelope(null)
  async activity(
    @Ctx() context: RequestContext,
    @Body() body: TelemetryActivityDto,
  ): Promise<void> {
    await this.analytics.activity(context, body);
  }
}
