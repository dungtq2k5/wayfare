import type {
  ProtoEnumBridge,
  ProviderHealth,
  SynthesisJobDetail,
  SynthesisJobSummary,
  VoiceCatalogue,
} from '@wayfare/contracts';
import {
  localizationTargetTypeProto,
  synthesisJobStatusProto,
  synthesisStageProto,
  synthesisTaskStatusProto,
  synthesisTriggerProto,
} from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { fromOptionalProtoTimestamp, fromProtoTimestamp } from '@wayfare/nest-common';
import type { ListJobsQueryDto } from './dto/admin-narration.dto';

function known<D extends string>(
  bridge: ProtoEnumBridge<D, number>,
  value: number | undefined,
  field: string,
): D {
  const member = bridge.fromProto(value);
  if (member === null) throw new Error(`narration sent an unknown ${field}: ${String(value)}`);
  return member;
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

/** A job as the monitor shows it. */
export function toSynthesisJobSummary(
  job: narrationGrpc.SynthesisJob | undefined,
): SynthesisJobSummary {
  if (job === undefined || job === null) throw new Error('narration answered without a job');
  return {
    id: job.id,
    targetType: known(localizationTargetTypeProto, job.targetType, 'targetType'),
    targetId: job.targetId ?? null,
    trigger: known(synthesisTriggerProto, job.trigger, 'trigger'),
    sourceContentHash: job.sourceContentHash,
    requestedLangs: job.requestedLangs,
    includeAudio: job.includeAudio,
    priority: job.priority,
    status: known(synthesisJobStatusProto, job.status, 'status'),
    totalTasks: job.totalTasks,
    completedTasks: job.completedTasks,
    failedTasks: job.failedTasks,
    requestedByUserId: job.requestedByUserId ?? null,
    requestedByDeviceId: job.requestedByDeviceId ?? null,
    errorSummary: job.errorSummary ?? null,
    createdAt: fromProtoTimestamp(job.createdAt, 'createdAt').toISOString(),
    startedAt: iso(fromOptionalProtoTimestamp(job.startedAt, 'startedAt')),
    finishedAt: iso(fromOptionalProtoTimestamp(job.finishedAt, 'finishedAt')),
  };
}

/** A job with every task. */
export function toSynthesisJobDetail(response: narrationGrpc.GetJobResponse): SynthesisJobDetail {
  return {
    ...toSynthesisJobSummary(response.job),
    tasks: response.tasks.map((task) => ({
      id: task.id,
      lang: task.lang,
      stage: known(synthesisStageProto, task.stage, 'stage'),
      status: known(synthesisTaskStatusProto, task.status, 'task status'),
      attempts: task.attempts,
      translationProvider: task.translationProvider ?? null,
      speechProvider: task.speechProvider ?? null,
      voiceId: task.voiceId ?? null,
      cacheKey: task.cacheKey ?? null,
      coalescedIntoTaskId: task.coalescedIntoTaskId ?? null,
      lastError: task.lastError ?? null,
      startedAt: iso(fromOptionalProtoTimestamp(task.startedAt, 'startedAt')),
      finishedAt: iso(fromOptionalProtoTimestamp(task.finishedAt, 'finishedAt')),
    })),
  };
}

/** One provider's health. */
export function toProviderHealth(provider: narrationGrpc.ProviderHealth): ProviderHealth {
  return {
    name: provider.name,
    role: provider.role === 'speech' ? 'speech' : 'translation',
    position: provider.position,
    breaker: provider.breaker === 'open' ? 'open' : 'closed',
    consecutiveFailures: provider.consecutiveFailures,
    errorRate: provider.errorRate,
    recentCalls: provider.recentCalls,
    coolingUntil: iso(fromOptionalProtoTimestamp(provider.coolingUntil, 'coolingUntil')),
    scope: 'process',
  };
}

/** One language's voices. */
export function toVoiceCatalogue(catalogue: narrationGrpc.VoiceCatalogue): VoiceCatalogue {
  return {
    lang: catalogue.lang,
    provider: catalogue.provider,
    pinnedVoiceId: catalogue.pinnedVoiceId ?? null,
    available: catalogue.available.map((voice) => ({
      id: voice.id,
      languageCode: voice.languageCode,
      gender: voice.gender ?? null,
    })),
  };
}

/** The `ListJobs` request. */
export function toListJobsRequest(query: ListJobsQueryDto): narrationGrpc.ListJobsRequest {
  return {
    page: { page: query.page, pageSize: query.pageSize, sort: query.sort },
    ...(query.status === undefined
      ? {}
      : { status: synthesisJobStatusProto.toProto(query.status) }),
    ...(query.targetType === undefined
      ? {}
      : { targetType: localizationTargetTypeProto.toProto(query.targetType) }),
    ...(query.targetId === undefined ? {} : { targetId: query.targetId }),
    ...(query.trigger === undefined
      ? {}
      : { trigger: synthesisTriggerProto.toProto(query.trigger) }),
  };
}
