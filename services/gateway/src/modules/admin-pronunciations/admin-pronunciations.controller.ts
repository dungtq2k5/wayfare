import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PronunciationEntry } from '@wayfare/contracts';
import {
  ApiEnvelope,
  ApiErrors,
  Ctx,
  NoStore,
  RateLimit,
  RequirePermission,
  SkipEnvelope,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext, Paged } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminPronunciationsService } from './admin-pronunciations.service';
import {
  PronunciationEntryResponseDto,
  PronunciationResultResponseDto,
} from './dto/admin-pronunciation-response.dto';
import {
  CreatePronunciationDto,
  PreviewPronunciationDto,
  PronunciationIdParamDto,
  PronunciationsQueryDto,
  UpdatePronunciationDto,
} from './dto/admin-pronunciation.dto';

/**
 * `/admin/narration/pronunciations` — how a term is read aloud (api-endpoints-plan §4.4,
 * rdm-spec N-5). A write re-voices every text holding the term, on a queue; a preview stores
 * nothing.
 */
@ApiTags('admin-pronunciations')
@UsesUpstream()
@Controller('admin/narration/pronunciations')
export class AdminPronunciationsController {
  constructor(private readonly pronunciations: AdminPronunciationsService) {}

  @Get()
  @RequirePermission('pronunciation.manage')
  @NoStore()
  @ApiOperation({ summary: 'The dictionary, by term.' })
  @ApiEnvelope(PronunciationEntryResponseDto, { list: 'cursor' })
  @ZodSerializerDto(PronunciationEntryResponseDto)
  list(
    @Ctx() context: AccountContext,
    @Query() query: PronunciationsQueryDto,
  ): Promise<Paged<PronunciationEntry>> {
    return this.pronunciations.list(context, query);
  }

  @Post()
  @RequirePermission('pronunciation.manage')
  @NoStore()
  @ApiOperation({
    summary: 'Add a term; every text that holds it is re-voiced, on a queue.',
  })
  @ApiEnvelope(PronunciationResultResponseDto)
  @ApiErrors('PRONUNCIATION_TERM_EXISTS')
  @ZodSerializerDto(PronunciationResultResponseDto)
  create(
    @Ctx() context: AccountContext,
    @Body() body: CreatePronunciationDto,
  ): Promise<{ entry: PronunciationEntry }> {
    return this.pronunciations.create(context, body);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('pronunciation.manage')
  @RateLimit('PRONUNCIATION_PREVIEW')
  @NoStore()
  @SkipEnvelope()
  // No static `Content-Type`: the `StreamableFile` carries `audio/mpeg` when there are bytes, so
  // a refusal is still an ordinary JSON envelope.
  @ApiOperation({ summary: 'How a sentence sounds with these entries. Nothing is stored.' })
  @ApiEnvelope(null, { status: 200, mediaType: 'audio/mpeg' })
  @ApiErrors('INVALID_STATE')
  preview(
    @Ctx() context: AccountContext,
    @Body() body: PreviewPronunciationDto,
  ): Promise<StreamableFile> {
    return this.pronunciations.preview(context, body);
  }

  @Patch(':id')
  @RequirePermission('pronunciation.manage')
  @NoStore()
  @ApiOperation({ summary: 'Change a replacement, its note or whether it applies.' })
  @ApiEnvelope(PronunciationResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(PronunciationResultResponseDto)
  update(
    @Ctx() context: AccountContext,
    @Param() params: PronunciationIdParamDto,
    @Body() body: UpdatePronunciationDto,
  ): Promise<{ entry: PronunciationEntry }> {
    return this.pronunciations.update(context, params.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('pronunciation.manage')
  @NoStore()
  @ApiOperation({ summary: 'Remove a term; its texts are re-voiced without it.' })
  @ApiEnvelope(null)
  @ApiErrors('RESOURCE_NOT_FOUND')
  remove(@Ctx() context: AccountContext, @Param() params: PronunciationIdParamDto): Promise<void> {
    return this.pronunciations.remove(context, params.id);
  }
}
