import {
  LocalizationTargetType,
  SynthesisFailureReason,
  SynthesisJobStatus,
  SynthesisStage,
  SynthesisTaskStatus,
  SynthesisTrigger,
} from '@wayfare/contracts';
import {
  localizationTargetTypeProto,
  synthesisFailureReasonProto,
  synthesisJobStatusProto,
  synthesisStageProto,
  synthesisTaskStatusProto,
  synthesisTriggerProto,
} from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import {
  toListJobsRequest,
  toProviderHealth,
  toSynthesisJobDetail,
  toSynthesisJobSummary,
  toVoiceCatalogue,
} from './admin-narration.mapper';

const at = new Date('2026-05-01T00:00:00.000Z');
const ts = toProtoTimestamp(at);
const job = (over: Partial<narrationGrpc.SynthesisJob> = {}) =>
  ({
    id: 'j1',
    targetType: localizationTargetTypeProto.toProto(LocalizationTargetType.PLACE),
    trigger: synthesisTriggerProto.toProto(SynthesisTrigger.APPROVAL),
    sourceContentHash: 'h',
    requestedLangs: ['en'],
    includeAudio: true,
    priority: 1,
    status: synthesisJobStatusProto.toProto(SynthesisJobStatus.RUNNING),
    totalTasks: 1,
    completedTasks: 0,
    failedTasks: 0,
    createdAt: ts,
    ...over,
  }) as narrationGrpc.SynthesisJob;
const task = (over: Partial<narrationGrpc.SynthesisTask> = {}) =>
  ({
    id: 't1',
    lang: 'en',
    stage: synthesisStageProto.toProto(SynthesisStage.TRANSLATE),
    status: synthesisTaskStatusProto.toProto(SynthesisTaskStatus.QUEUED),
    attempts: 0,
    providerWaits: 0,
    ...over,
  }) as narrationGrpc.SynthesisTask;

describe('a synthesis job', () => {
  it('reads absent target, requester, error and times as null', () => {
    expect(toSynthesisJobSummary(job())).toMatchObject({
      targetType: LocalizationTargetType.PLACE,
      targetId: null,
      trigger: SynthesisTrigger.APPROVAL,
      status: SynthesisJobStatus.RUNNING,
      requestedByUserId: null,
      errorSummary: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(
      toSynthesisJobSummary(job({ targetId: 'p1', startedAt: ts, finishedAt: ts })),
    ).toMatchObject({ targetId: 'p1', startedAt: at.toISOString(), finishedAt: at.toISOString() });
  });

  it('refuses no job, and a status this build doesn’t know', () => {
    expect(() => toSynthesisJobSummary(undefined)).toThrow('narration answered without a job');
    expect(() => toSynthesisJobSummary(job({ status: 99 as never }))).toThrow(
      'narration sent an unknown status: 99',
    );
  });

  it('reads each task, its failure reason only when it failed', () => {
    const detail = toSynthesisJobDetail({
      job: job(),
      tasks: [
        task(),
        task({
          id: 't2',
          translationProvider: 'google',
          failureReason: synthesisFailureReasonProto.toProto(
            SynthesisFailureReason.PROVIDER_UNAVAILABLE,
          ),
        }),
      ],
    });
    expect(detail.tasks).toMatchObject([
      { stage: SynthesisStage.TRANSLATE, translationProvider: null, failureReason: null },
      {
        translationProvider: 'google',
        failureReason: SynthesisFailureReason.PROVIDER_UNAVAILABLE,
      },
    ]);
  });
});

describe('provider health and voices', () => {
  const provider = (role: string, breaker: string) =>
    ({
      name: 'p',
      role,
      position: 0,
      breaker,
      consecutiveFailures: 0,
      errorRate: 0,
      recentCalls: 0,
    }) as narrationGrpc.ProviderHealth;

  it('reads anything but speech as translation, anything but open as closed', () => {
    expect(toProviderHealth(provider('speech', 'open'))).toMatchObject({
      role: 'speech',
      breaker: 'open',
      coolingUntil: null,
      scope: 'process',
    });
    expect(toProviderHealth(provider('translation', 'half'))).toMatchObject({
      role: 'translation',
      breaker: 'closed',
    });
  });

  it('reads an unpinned catalogue and an ungendered voice as null', () => {
    expect(
      toVoiceCatalogue({
        lang: 'en',
        provider: 'google',
        available: [{ id: 'v1', languageCode: 'en-US' }],
      }),
    ).toEqual({
      lang: 'en',
      provider: 'google',
      pinnedVoiceId: null,
      available: [{ id: 'v1', languageCode: 'en-US', gender: null }],
    });
    expect(
      toVoiceCatalogue({
        lang: 'en',
        provider: 'google',
        pinnedVoiceId: 'v1',
        available: [],
      }).pinnedVoiceId,
    ).toBe('v1');
  });
});

describe('the ListJobs request', () => {
  it('sends only the filters given', () => {
    const page = { page: 1, pageSize: 20, sort: '-createdAt' };
    expect(toListJobsRequest(page as never)).toEqual({ page });
    expect(
      toListJobsRequest({
        ...page,
        status: SynthesisJobStatus.QUEUED,
        targetType: LocalizationTargetType.TOUR,
        targetId: 't1',
        trigger: SynthesisTrigger.ON_DEMAND,
      } as never),
    ).toEqual({
      page,
      status: synthesisJobStatusProto.toProto(SynthesisJobStatus.QUEUED),
      targetType: localizationTargetTypeProto.toProto(LocalizationTargetType.TOUR),
      targetId: 't1',
      trigger: synthesisTriggerProto.toProto(SynthesisTrigger.ON_DEMAND),
    });
  });
});
