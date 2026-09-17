import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, Auth, Ctx, ETagged, UsesUpstream } from '@wayfare/nest-common';
import type { ETaggedResult, RequestContext, WithMeta } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { SyncMetaResponseDto, SyncPlacesResponseDto } from './dto/sync-response.dto';
import { SyncPlacesQueryDto } from './dto/sync.dto';
import { SyncService } from './sync.service';

/** `/sync/places` — the offline corpus, delta by delta (api-endpoints-plan §2.1). */
@ApiTags('sync')
@UsesUpstream()
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('places')
  @Auth('DEVICE')
  @ETagged()
  @ApiOperation({
    summary:
      'Every live Place of an area that changed since a version. Page with `meta.complete`; revalidate with `If-None-Match`.',
  })
  @ApiEnvelope(SyncPlacesResponseDto, { meta: SyncMetaResponseDto })
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(SyncPlacesResponseDto)
  places(
    @Ctx() context: RequestContext,
    @Query() query: SyncPlacesQueryDto,
  ): Promise<ETaggedResult<WithMeta<SyncPlacesResponseDto>>> {
    return this.sync.places(context, query);
  }
}
