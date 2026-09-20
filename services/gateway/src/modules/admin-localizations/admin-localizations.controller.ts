import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Correction, LocalizationOverview } from '@wayfare/contracts';
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
import { AdminLocalizationsService } from './admin-localizations.service';
import {
  CorrectionResultResponseDto,
  LocalizationOverviewResponseDto,
} from './dto/admin-localization-response.dto';
import {
  LocalizationLangParamDto,
  LocalizationTargetParamDto,
  PutCorrectionDto,
} from './dto/admin-localization.dto';

/**
 * `/admin/narration/localizations` — staff corrections of a machine translation
 * (api-endpoints-plan §4.5, rdm-spec N-7). A correction is held against the source version it was
 * written for; the Place keeps its old words until the corrected pair is ready.
 */
@ApiTags('admin-localizations')
@UsesUpstream()
@Controller('admin/narration/localizations')
export class AdminLocalizationsController {
  constructor(private readonly localizations: AdminLocalizationsService) {}

  @Get(':targetType/:targetId')
  @RequirePermission('localization.edit')
  @NoStore()
  @ApiOperation({ summary: 'Each language: what it says now, and the correction held for it.' })
  @ApiEnvelope(LocalizationOverviewResponseDto)
  @ApiErrors('LOCALIZATION_TARGET_UNAVAILABLE')
  @ZodSerializerDto(LocalizationOverviewResponseDto)
  overview(
    @Ctx() context: AccountContext,
    @Param() params: LocalizationTargetParamDto,
  ): Promise<LocalizationOverview> {
    return this.localizations.overview(context, params.targetType, params.targetId);
  }

  @Put(':targetType/:targetId/:lang')
  @RequirePermission('localization.edit')
  @NoStore()
  @ApiOperation({
    summary:
      'Correct one language against the source version shown; text and audio follow together.',
  })
  @ApiEnvelope(CorrectionResultResponseDto)
  @ApiErrors('LOCALIZATION_SOURCE_CHANGED', 'LOCALIZATION_TARGET_UNAVAILABLE')
  @ZodSerializerDto(CorrectionResultResponseDto)
  put(
    @Ctx() context: AccountContext,
    @Param() params: LocalizationLangParamDto,
    @Body() body: PutCorrectionDto,
  ): Promise<{ correction: Correction }> {
    return this.localizations.put(context, params, body);
  }

  @Delete(':targetType/:targetId/:lang')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('localization.edit')
  @NoStore()
  @ApiOperation({ summary: 'Drop the correction; the machine translation comes back.' })
  @ApiEnvelope(null)
  @ApiErrors('RESOURCE_NOT_FOUND', 'LOCALIZATION_TARGET_UNAVAILABLE')
  revert(@Ctx() context: AccountContext, @Param() params: LocalizationLangParamDto): Promise<void> {
    return this.localizations.revert(context, params);
  }
}
