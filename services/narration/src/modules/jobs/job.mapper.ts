import type {
  LocalizationTargetType,
  SynthesisJobStatus,
  SynthesisStage,
  SynthesisTaskStatus,
  SynthesisTrigger,
} from '@wayfare/contracts';
import {
  localizationTargetTypeProto,
  synthesisJobStatusProto,
  synthesisStageProto,
  synthesisTaskStatusProto,
  synthesisTriggerProto,
} from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';

/** The job columns the monitor shows (rdm-spec N-1). */
export const JOB_SELECT = {
  id: true,
  targetType: true,
  targetId: true,
  trigger: true,
  sourceContentHash: true,
  requestedLangs: true,
  includeAudio: true,
  priority: true,
  status: true,
  totalTasks: true,
  completedTasks: true,
  failedTasks: true,
  requestedByUserId: true,
  requestedByDeviceId: true,
  errorSummary: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
} as const satisfies Prisma.SynthesisJobSelect;

/** A job row as selected. */
export type JobRow = Prisma.SynthesisJobGetPayload<{ select: typeof JOB_SELECT }>;

/** The task columns the monitor shows (rdm-spec N-2). */
export const TASK_SELECT = {
  id: true,
  lang: true,
  stage: true,
  status: true,
  attempts: true,
  translationProvider: true,
  speechProvider: true,
  voiceId: true,
  cacheKey: true,
  coalescedIntoTaskId: true,
  lastError: true,
  startedAt: true,
  finishedAt: true,
} as const satisfies Prisma.SynthesisTaskSelect;

/** A task row as selected. */
export type TaskRow = Prisma.SynthesisTaskGetPayload<{ select: typeof TASK_SELECT }>;

const optional = <T>(value: T | null): T | undefined => value ?? undefined;
const instant = (value: Date | null) => (value === null ? undefined : toProtoTimestamp(value));

/** A job, as the admin RPCs return it. */
export function toSynthesisJob(row: JobRow): narrationGrpc.SynthesisJob {
  return {
    id: row.id,
    targetType: localizationTargetTypeProto.toProto(row.targetType as LocalizationTargetType),
    targetId: optional(row.targetId),
    trigger: synthesisTriggerProto.toProto(row.trigger as SynthesisTrigger),
    sourceContentHash: row.sourceContentHash,
    requestedLangs: row.requestedLangs,
    includeAudio: row.includeAudio,
    priority: row.priority,
    status: synthesisJobStatusProto.toProto(row.status as SynthesisJobStatus),
    totalTasks: row.totalTasks,
    completedTasks: row.completedTasks,
    failedTasks: row.failedTasks,
    requestedByUserId: optional(row.requestedByUserId),
    requestedByDeviceId: optional(row.requestedByDeviceId),
    errorSummary: optional(row.errorSummary),
    createdAt: toProtoTimestamp(row.createdAt),
    startedAt: instant(row.startedAt),
    finishedAt: instant(row.finishedAt),
  };
}

/** A task, as the job detail returns it; its error is already redacted. */
export function toSynthesisTask(row: TaskRow): narrationGrpc.SynthesisTask {
  return {
    id: row.id,
    lang: row.lang,
    stage: synthesisStageProto.toProto(row.stage as SynthesisStage),
    status: synthesisTaskStatusProto.toProto(row.status as SynthesisTaskStatus),
    attempts: row.attempts,
    translationProvider: optional(row.translationProvider),
    speechProvider: optional(row.speechProvider),
    voiceId: optional(row.voiceId),
    cacheKey: optional(row.cacheKey),
    coalescedIntoTaskId: optional(row.coalescedIntoTaskId),
    lastError: optional(row.lastError),
    startedAt: instant(row.startedAt),
    finishedAt: instant(row.finishedAt),
  };
}
