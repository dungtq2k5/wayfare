import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ProviderHealth, SynthesisJobDetail, VoiceCatalogue } from '@wayfare/contracts';
import {
  ApiEnvelope,
  ApiErrors,
  Ctx,
  NoStore,
  RequirePermission,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext, Paged } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminNarrationService } from './admin-narration.service';
import {
  ProviderHealthResponseDto,
  SynthesisJobDetailResponseDto,
  SynthesisJobResponseDto,
  SynthesisJobResultResponseDto,
  VoiceCatalogueResponseDto,
} from './dto/admin-narration-response.dto';
import { CreateJobDto, JobIdParamDto, ListJobsQueryDto } from './dto/admin-narration.dto';

const ACTION_ERRORS = ['RESOURCE_NOT_FOUND', 'SYNTHESIS_JOB_NOT_ACTIVE'] as const;

/** `/admin/narration` — the synthesis job monitor (api-endpoints-plan §4.3). */
@ApiTags('admin-narration')
@UsesUpstream()
@Controller('admin/narration')
export class AdminNarrationController {
  constructor(private readonly narration: AdminNarrationService) {}

  @Get('jobs')
  @RequirePermission('narration.job.read')
  @NoStore()
  @ApiOperation({ summary: 'Synthesis jobs, newest first, a page at a time.' })
  @ApiEnvelope(SynthesisJobResponseDto, { list: 'page' })
  @ZodSerializerDto(SynthesisJobResponseDto)
  list(
    @Ctx() context: AccountContext,
    @Query() query: ListJobsQueryDto,
  ): Promise<Paged<SynthesisJobResponseDto>> {
    return this.narration.list(context, query);
  }

  @Get('jobs/:id')
  @RequirePermission('narration.job.read')
  @NoStore()
  @ApiOperation({
    summary: 'A job with every task: stage, provider used, attempts, redacted error.',
  })
  @ApiEnvelope(SynthesisJobDetailResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(SynthesisJobDetailResponseDto)
  get(@Ctx() context: AccountContext, @Param() params: JobIdParamDto): Promise<SynthesisJobDetail> {
    return this.narration.get(context, params.id);
  }

  @Post('jobs')
  @RequirePermission('narration.job.manage')
  @NoStore()
  @ApiOperation({ summary: 'Regenerate a target from its current text; older text is superseded.' })
  @ApiEnvelope(SynthesisJobResultResponseDto)
  @ApiErrors('LOCALIZATION_TARGET_UNAVAILABLE')
  @ZodSerializerDto(SynthesisJobResultResponseDto)
  create(
    @Ctx() context: AccountContext,
    @Body() body: CreateJobDto,
  ): Promise<SynthesisJobResultResponseDto> {
    return this.narration.create(context, body);
  }

  @Post('jobs/:id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('narration.job.manage')
  @NoStore()
  @ApiOperation({ summary: 'Running tasks finish; queued tasks wait.' })
  @ApiEnvelope(SynthesisJobResultResponseDto)
  @ApiErrors(...ACTION_ERRORS)
  @ZodSerializerDto(SynthesisJobResultResponseDto)
  pause(
    @Ctx() context: AccountContext,
    @Param() params: JobIdParamDto,
  ): Promise<SynthesisJobResultResponseDto> {
    return this.narration.act(context, 'pauseJob', params.id);
  }

  @Post('jobs/:id/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('narration.job.manage')
  @NoStore()
  @ApiOperation({ summary: 'Queued tasks run again.' })
  @ApiEnvelope(SynthesisJobResultResponseDto)
  @ApiErrors(...ACTION_ERRORS)
  @ZodSerializerDto(SynthesisJobResultResponseDto)
  resume(
    @Ctx() context: AccountContext,
    @Param() params: JobIdParamDto,
  ): Promise<SynthesisJobResultResponseDto> {
    return this.narration.act(context, 'resumeJob', params.id);
  }

  @Post('jobs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('narration.job.manage')
  @NoStore()
  @ApiOperation({ summary: 'Stop the job; nothing of it is published again.' })
  @ApiEnvelope(SynthesisJobResultResponseDto)
  @ApiErrors(...ACTION_ERRORS)
  @ZodSerializerDto(SynthesisJobResultResponseDto)
  cancel(
    @Ctx() context: AccountContext,
    @Param() params: JobIdParamDto,
  ): Promise<SynthesisJobResultResponseDto> {
    return this.narration.act(context, 'cancelJob', params.id);
  }

  @Post('jobs/:id/retry-failed')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('narration.job.manage')
  @NoStore()
  @ApiOperation({ summary: 'New attempts for the failed tasks only.' })
  @ApiEnvelope(SynthesisJobResultResponseDto)
  @ApiErrors(...ACTION_ERRORS)
  @ZodSerializerDto(SynthesisJobResultResponseDto)
  retryFailed(
    @Ctx() context: AccountContext,
    @Param() params: JobIdParamDto,
  ): Promise<SynthesisJobResultResponseDto> {
    return this.narration.act(context, 'retryFailedTasks', params.id);
  }

  @Get('providers')
  @RequirePermission('narration.job.read')
  @NoStore()
  @ApiOperation({
    summary: "Each provider's breaker and error rate, as one narration process sees them.",
  })
  @ApiEnvelope(ProviderHealthResponseDto, { array: true })
  @ZodSerializerDto([ProviderHealthResponseDto])
  providers(@Ctx() context: AccountContext): Promise<ProviderHealth[]> {
    return this.narration.providers(context);
  }

  @Get('voices')
  @RequirePermission('narration.job.read')
  @NoStore()
  @ApiOperation({
    summary: 'The pinned voice per language and provider, with the provider catalogue.',
  })
  @ApiEnvelope(VoiceCatalogueResponseDto, { array: true })
  @ZodSerializerDto([VoiceCatalogueResponseDto])
  voices(@Ctx() context: AccountContext): Promise<VoiceCatalogue[]> {
    return this.narration.voices(context);
  }
}
