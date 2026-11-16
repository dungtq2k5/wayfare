import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UiBundleStatus } from '@wayfare/contracts';
import type { UiBundleResponse } from '@wayfare/contracts';
import { ApiEnvelope, Auth, Ctx, ETaggedResult, ETagged, UsesUpstream } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import type { Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import { UiBundleResponseDto } from './dto/i18n-response.dto';
import { BundleParamDto, BundleQueryDto } from './dto/i18n.dto';
import { I18nService } from './i18n.service';

/** How long a ready bundle may be held, and how long a stale one may still be used. */
const READY_CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';

/**
 * `/i18n/bundles` — the UI strings both apps read (api-endpoints-plan §4.2). A bundle is public and
 * changes only on deploy, so it is cached hard and revalidated by its `ETag`; one still being
 * translated is not cached at all, and says when to ask again.
 */
@ApiTags('i18n')
@UsesUpstream()
@Controller('i18n')
export class I18nController {
  constructor(private readonly i18n: I18nService) {}

  @Get('bundles/:namespace/:locale')
  @Auth('PUBLIC')
  @ETagged()
  @ApiOperation({
    summary: 'One namespace of one locale; an untranslated one answers English and is queued.',
  })
  @ApiEnvelope(UiBundleResponseDto)
  @ZodSerializerDto(UiBundleResponseDto)
  async bundle(
    @Ctx() context: RequestContext,
    @Param() params: BundleParamDto,
    // A hint only: the answer is always the server's current version, never a 304 against an
    // older one, so a client that fell behind converges without a cache buster.
    @Query() _query: BundleQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ETaggedResult<UiBundleResponse>> {
    const bundle = await this.i18n.bundle(context, params);
    if (bundle.status === UiBundleStatus.PENDING) {
      res.setHeader('Cache-Control', 'no-store');
      if (bundle.retryAfterMs !== null) {
        res.setHeader('Retry-After', String(Math.ceil(bundle.retryAfterMs / 1000)));
      }
    } else {
      res.setHeader('Cache-Control', READY_CACHE_CONTROL);
    }
    return ETaggedResult.of(bundle, bundle.sourceHash);
  }
}
