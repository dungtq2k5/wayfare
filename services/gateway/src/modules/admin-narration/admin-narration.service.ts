import { Injectable } from '@nestjs/common';
import type {
  ProviderHealth,
  SynthesisJobDetail,
  SynthesisJobSummary,
  VoiceCatalogue,
} from '@wayfare/contracts';
import { localizationTargetTypeProto } from '@wayfare/contracts/grpc';
import { Paged } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { NarrationServiceGrpcClient } from '../narration-client/narration-service-grpc.client';
import {
  toListJobsRequest,
  toProviderHealth,
  toSynthesisJobDetail,
  toSynthesisJobSummary,
  toVoiceCatalogue,
} from './admin-narration.mapper';
import type { CreateJobDto, ListJobsQueryDto } from './dto/admin-narration.dto';

type JobResult = Promise<{ job: SynthesisJobSummary }>;
type Action = 'pauseJob' | 'resumeJob' | 'cancelJob' | 'retryFailedTasks';

/** `/admin/narration`, backed by `narration.SynthesisAdminService`. */
@Injectable()
export class AdminNarrationService {
  constructor(private readonly narration: NarrationServiceGrpcClient) {}

  async list(
    context: AccountContext,
    query: ListJobsQueryDto,
  ): Promise<Paged<SynthesisJobSummary>> {
    const response = await this.narration.synthesisAdmin.call(
      'listJobs',
      toListJobsRequest(query),
      context,
    );
    const page = response.page;
    return Paged.page(
      response.jobs.map(toSynthesisJobSummary),
      page?.page ?? query.page,
      page?.pageSize ?? query.pageSize,
      page?.total ?? 0,
    );
  }

  async get(context: AccountContext, jobId: string): Promise<SynthesisJobDetail> {
    return toSynthesisJobDetail(
      await this.narration.synthesisAdmin.call('getJob', { jobId }, context),
    );
  }

  async create(context: AccountContext, body: CreateJobDto): JobResult {
    const response = await this.narration.synthesisAdmin.call(
      'createManualJob',
      {
        targetType: localizationTargetTypeProto.toProto(body.targetType),
        targetId: body.targetId,
        langs: body.langs,
        includeAudio: body.includeAudio,
      },
      context,
    );
    return { job: toSynthesisJobSummary(response.job) };
  }

  async act(context: AccountContext, action: Action, jobId: string): JobResult {
    const response = await this.narration.synthesisAdmin.call(action, { jobId }, context);
    return { job: toSynthesisJobSummary(response.job) };
  }

  async providers(context: AccountContext): Promise<ProviderHealth[]> {
    const response = await this.narration.synthesisAdmin.call('listProviders', {}, context);
    return response.providers.map(toProviderHealth);
  }

  async voices(context: AccountContext): Promise<VoiceCatalogue[]> {
    const response = await this.narration.synthesisAdmin.call('listVoices', {}, context);
    return response.voices.map(toVoiceCatalogue);
  }
}
