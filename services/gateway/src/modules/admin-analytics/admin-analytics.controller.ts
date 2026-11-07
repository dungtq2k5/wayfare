import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  Ctx,
  NoStore,
  RequirePermission,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminAnalyticsService } from './admin-analytics.service';
import {
  AdminAnalyticsRangeQueryDto,
  AdminHeatmapQueryDto,
  AdminRuntimeQueryDto,
  AdminTopPlacesQueryDto,
} from './dto/admin-analytics.dto';
import {
  AdminAnalyticsOverviewResponseDto,
  AdminHeatmapResponseDto,
  AdminRuntimeResponseDto,
  AdminTopPlacesResponseDto,
} from './dto/admin-analytics-response.dto';

/**
 * `/admin/analytics` — Insights → Analytics (api-endpoints-plan §7): always totals, never a person.
 * Ranking here only reads what tourists heard; nothing here changes what plays.
 */
@ApiTags('admin-analytics')
@UsesUpstream()
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('overview')
  @RequirePermission('analytics.read')
  @NoStore()
  @ApiOperation({
    summary:
      'Sessions, narrations by trigger and audio tier, completion, pack installs, languages, QR scans and the active-device estimate, per day and in total.',
  })
  @ApiEnvelope(AdminAnalyticsOverviewResponseDto)
  @ApiErrors('UPSTREAM_UNAVAILABLE')
  @ZodSerializerDto(AdminAnalyticsOverviewResponseDto)
  overview(
    @Ctx() context: AccountContext,
    @Query() query: AdminAnalyticsRangeQueryDto,
  ): Promise<AdminAnalyticsOverviewResponseDto> {
    return this.analytics.overview(context, query);
  }

  @Get('places/top')
  @RequirePermission('analytics.read')
  @NoStore()
  @ApiOperation({ summary: 'The Places most heard by a metric; a deleted Place is left out.' })
  @ApiEnvelope(AdminTopPlacesResponseDto)
  @ApiErrors('UPSTREAM_UNAVAILABLE')
  @ZodSerializerDto(AdminTopPlacesResponseDto)
  topPlaces(
    @Ctx() context: AccountContext,
    @Query() query: AdminTopPlacesQueryDto,
  ): Promise<AdminTopPlacesResponseDto> {
    return this.analytics.topPlaces(context, query);
  }

  @Get('heatmap')
  @RequirePermission('analytics.read')
  @NoStore()
  @ApiOperation({
    summary:
      "An Area's ~150 m squares over the days and the hours of day (Vietnam time); squares with fewer than 5 phones are absent.",
  })
  @ApiEnvelope(AdminHeatmapResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'UPSTREAM_UNAVAILABLE')
  @ZodSerializerDto(AdminHeatmapResponseDto)
  heatmap(
    @Ctx() context: AccountContext,
    @Query() query: AdminHeatmapQueryDto,
  ): Promise<AdminHeatmapResponseDto> {
    return this.analytics.heatmap(context, query);
  }

  @Get('runtime-activity')
  @RequirePermission('analytics.read')
  @NoStore()
  @ApiOperation({
    summary:
      "The consent-free lane, an estimate: an Area's installs per hour, or with current=true every Area this hour so far.",
  })
  @ApiEnvelope(AdminRuntimeResponseDto)
  @ApiErrors('UPSTREAM_UNAVAILABLE')
  @ZodSerializerDto(AdminRuntimeResponseDto)
  runtime(
    @Ctx() context: AccountContext,
    @Query() query: AdminRuntimeQueryDto,
  ): Promise<AdminRuntimeResponseDto> {
    return this.analytics.runtime(context, query);
  }
}
