import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CorrectionListItem } from '@wayfare/contracts';
import { ApiEnvelope, Ctx, NoStore, RequirePermission, UsesUpstream } from '@wayfare/nest-common';
import type { AccountContext, Paged } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminLocalizationsService } from '../admin-localizations/admin-localizations.service';
import { CorrectionListItemResponseDto } from '../admin-localizations/dto/admin-localization-response.dto';
import { CorrectionsQueryDto } from '../admin-localizations/dto/admin-localization.dto';

/**
 * `/admin/narration/corrections` — every target's corrections in one list: each language's latest,
 * in use or needing review (api-endpoints-plan §4.5, rdm-spec N-7).
 */
@ApiTags('admin-localizations')
@UsesUpstream()
@Controller('admin/narration/corrections')
export class AdminCorrectionsController {
  constructor(private readonly localizations: AdminLocalizationsService) {}

  @Get()
  @RequirePermission('localization.edit')
  @NoStore()
  @ApiOperation({ summary: 'The corrections across targets, needing review first.' })
  @ApiEnvelope(CorrectionListItemResponseDto, { list: 'cursor' })
  @ZodSerializerDto(CorrectionListItemResponseDto)
  list(
    @Ctx() context: AccountContext,
    @Query() query: CorrectionsQueryDto,
  ): Promise<Paged<CorrectionListItem>> {
    return this.localizations.list(context, query);
  }
}
