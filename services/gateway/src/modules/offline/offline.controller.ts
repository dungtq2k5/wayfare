import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OfflineManifest, OfflineManifestDiff } from '@wayfare/contracts';
import {
  ApiEnvelope,
  ApiErrors,
  Auth,
  Ctx,
  PrivateCache,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  OfflineManifestDiffResponseDto,
  OfflineManifestResponseDto,
} from './dto/offline-response.dto';
import { ManifestDiffQueryDto, ManifestQueryDto, OfflineAreaParamDto } from './dto/offline.dto';
import { OfflineService } from './offline.service';

/**
 * `/offline/areas/:areaId/manifest` — what a device downloads to use an area offline
 * (api-endpoints-plan §2.4). The files themselves are served by the bucket, never the gateway.
 */
@ApiTags('offline')
@UsesUpstream()
@Controller('offline/areas/:areaId/manifest')
export class OfflineController {
  constructor(private readonly offline: OfflineService) {}

  @Get()
  @Auth('DEVICE')
  @PrivateCache(60)
  @ApiOperation({
    summary: 'The area’s offline pack: the map, a places snapshot, card photos and audio.',
  })
  @ApiEnvelope(OfflineManifestResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(OfflineManifestResponseDto)
  manifest(
    @Ctx() context: RequestContext,
    @Param() params: OfflineAreaParamDto,
    @Query() query: ManifestQueryDto,
  ): Promise<OfflineManifest> {
    return this.offline.manifest(context, params.areaId, query);
  }

  @Get('diff')
  @Auth('DEVICE')
  @PrivateCache(60)
  @ApiOperation({
    summary: 'What changed since the pack a device holds; the map only when it changed.',
  })
  @ApiEnvelope(OfflineManifestDiffResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'DIFF_UNAVAILABLE')
  @ZodSerializerDto(OfflineManifestDiffResponseDto)
  diff(
    @Ctx() context: RequestContext,
    @Param() params: OfflineAreaParamDto,
    @Query() query: ManifestDiffQueryDto,
  ): Promise<OfflineManifestDiff> {
    return this.offline.diff(context, params.areaId, query);
  }
}
