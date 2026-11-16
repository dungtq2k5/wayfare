import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  Auth,
  Ctx,
  NoStore,
  SkipEnvelope,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import type { Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  OwnerStatsExportQueryDto,
  OwnerStatsPlaceParamDto,
  OwnerStatsQueryDto,
} from './dto/owner-stats.dto';
import { OwnerStatsResponseDto, OwnerVenueStatsResponseDto } from './dto/owner-stats-response.dto';
import { OwnerStatsService } from './owner-stats.service';

/**
 * `/owner/stats` — My stats (api-endpoints-plan §7): the owner's Venues at their plan's depth.
 * Only tourists who agreed are counted; QR scans are every scan.
 */
@ApiTags('owner-stats')
@UsesUpstream()
@Controller('owner/stats')
export class OwnerStatsController {
  constructor(private readonly stats: OwnerStatsService) {}

  @Get('places')
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({
    summary:
      "Each Venue's totals over the range and the series across them. A figure beyond the plan is absent, never 0.",
  })
  @ApiEnvelope(OwnerStatsResponseDto)
  @ApiErrors('ANALYTICS_LEVEL_INSUFFICIENT', 'UPSTREAM_UNAVAILABLE')
  @ZodSerializerDto(OwnerStatsResponseDto)
  places(
    @Ctx() context: AccountContext,
    @Query() query: OwnerStatsQueryDto,
  ): Promise<OwnerStatsResponseDto> {
    return this.stats.places(context, query);
  }

  @Get('places/:id')
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: "One Venue's totals and its daily series over the range." })
  @ApiEnvelope(OwnerVenueStatsResponseDto)
  @ApiErrors('ANALYTICS_LEVEL_INSUFFICIENT', 'RESOURCE_NOT_FOUND', 'UPSTREAM_UNAVAILABLE')
  @ZodSerializerDto(OwnerVenueStatsResponseDto)
  place(
    @Ctx() context: AccountContext,
    @Param() params: OwnerStatsPlaceParamDto,
    @Query() query: OwnerStatsQueryDto,
  ): Promise<OwnerVenueStatsResponseDto> {
    return this.stats.place(context, params.id, query);
  }

  @Get('export')
  @Auth('OWNER')
  @NoStore()
  @SkipEnvelope()
  @ApiOperation({
    summary:
      'The CSV: one row per Venue per day, the header in `lang`. Pro (`FULL`) only; a refusal stays a JSON envelope.',
  })
  @ApiEnvelope(null, { status: 200, mediaType: 'text/csv' })
  @ApiErrors('ANALYTICS_LEVEL_INSUFFICIENT', 'UPSTREAM_UNAVAILABLE')
  async export(
    @Ctx() context: AccountContext,
    @Query() query: OwnerStatsExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { csv, filename } = await this.stats.export(context, query);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(Buffer.from(csv, 'utf8'), { type: 'text/csv; charset=utf-8' });
  }
}
