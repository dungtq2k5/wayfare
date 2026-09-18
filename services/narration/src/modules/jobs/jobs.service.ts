import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  CATALOG_MENU_CONTENT_CHANGED,
  CATALOG_PLACE_CONTENT_CHANGED,
  isSupportedLanguage,
  LocalizationTargetType,
  SOURCE_LANGUAGE,
  SYNTHESIS_PRIORITY,
  SynthesisJobStatus,
  SynthesisStage,
  SynthesisTaskStatus,
  SynthesisTrigger,
  zLanguage,
  zPageQuery,
  zUuidV7,
} from '@wayfare/contracts';
import type { AuditRecordPayload, EventPayload } from '@wayfare/contracts';
import {
  localizationTargetTypeProto,
  synthesisJobStatusProto,
  synthesisTriggerProto,
} from '@wayfare/contracts/grpc';
import type { catalogGrpc, narrationGrpc } from '@wayfare/contracts/grpc';
import {
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  requireProtoEnum,
  rpcError,
  toProtoTimestamp,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersHealthService } from '../providers-health/providers-health.service';
import type { AfterCommit } from '../tasks/domain/after-commit';
import { TasksService } from '../tasks/tasks.service';
import type { NarrationTx } from '../tasks/tasks.service';
import {
  ACTIVE_TASK_STATUSES,
  LIVE_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
} from './domain/job-status';
import { jobsToSupersede } from './domain/supersede';
import { JOB_SELECT, TASK_SELECT, toSynthesisJob, toSynthesisTask } from './job.mapper';

/** The targets narration localizes now: tours and offers come with their docs. */
type NarratedTarget = LocalizationTargetType.PLACE | LocalizationTargetType.MENU_ITEM;

/** What a new job is (rdm-spec N-1). */
export interface NewJob {
  readonly targetType: NarratedTarget;
  readonly targetId: string;
  readonly sourceContentHash: string;
  readonly langs: readonly string[];
  readonly includeAudio: boolean;
  readonly trigger: SynthesisTrigger;
  readonly requestedByUserId?: string;
  readonly requestedByDeviceId?: string;
}

/** Who asked, for the audit record. */
export type JobActor =
  | { readonly type: AuditActorType.USER; readonly userId: string }
  | { readonly type: AuditActorType.DEVICE; readonly deviceId: string };

// Widened: statuses are read from the database as plain strings.
const JOB_QUEUED: string = SynthesisJobStatus.QUEUED;
const JOB_RUNNING: string = SynthesisJobStatus.RUNNING;
const JOB_PAUSED: string = SynthesisJobStatus.PAUSED;
const JOB_PARTIALLY_FAILED: string = SynthesisJobStatus.PARTIALLY_FAILED;
const JOB_FAILED: string = SynthesisJobStatus.FAILED;
const TASK_QUEUED: string = SynthesisTaskStatus.QUEUED;

const issue = (path: string, code = 'invalid_value') =>
  rpcError('VALIDATION_FAILED', { issues: [{ path, code }] });

const listFields = z.object({
  page: zPageQuery({ sort: ['createdAt'], defaultSort: '-createdAt' }),
  status: z.number().optional(),
  targetType: z.number().optional(),
  targetId: zUuidV7.optional(),
  trigger: z.number().optional(),
});

const jobIdFields = z.object({ jobId: zUuidV7 });

const manualFields = z.object({
  targetType: z.number(),
  targetId: zUuidV7,
  langs: z.array(zLanguage).min(1),
  includeAudio: z.boolean(),
});

/** The target's source hash, or null when catalog has no live target (api-endpoints-plan §12.2). */
export function liveSourceHash(response: catalogGrpc.GetLocalizationSourceResponse): string | null {
  const place = response.place ?? null;
  if (place !== null) return place.deleted ? null : place.contentHash;
  return response.menuItem?.contentHash ?? null;
}

/**
 * Synthesis jobs (rdm-spec N-1): created from catalog's events, on demand and by staff, superseded
 * by newer text, and paused, resumed, cancelled and retried from the monitor (api-endpoints-plan §4.3).
 */
@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly tasks: TasksService,
    private readonly catalog: CatalogServiceGrpcClient,
    private readonly providers: ProvidersHealthService,
  ) {}

  /**
   * Creates a job and its tasks, each made active or coalesced (rdm-spec N-1, N-2). Live jobs for
   * the same target made from other text are superseded first. Returns the job's id.
   */
  async createJob(tx: NarrationTx, fx: AfterCommit, input: NewJob): Promise<string> {
    const langs = [...new Set(input.langs)];
    if (langs.length === 0 || !langs.every(isSupportedLanguage)) {
      throw new Error('a job needs supported languages');
    }
    if (input.includeAudio && input.targetType !== LocalizationTargetType.PLACE) {
      throw new Error('only a Place has audio');
    }
    await this.supersede(tx, fx, input);
    const job = await tx.synthesisJob.create({
      data: {
        targetType: input.targetType,
        targetId: input.targetId,
        trigger: input.trigger,
        sourceContentHash: input.sourceContentHash,
        requestedLangs: langs,
        includeAudio: input.includeAudio,
        priority: SYNTHESIS_PRIORITY[input.trigger],
        status: SynthesisJobStatus.QUEUED,
        totalTasks: langs.length,
        requestedByUserId: input.requestedByUserId ?? null,
        requestedByDeviceId: input.requestedByDeviceId ?? null,
      },
      select: { id: true },
    });
    // Created following nothing; `activate` decides.
    await tx.synthesisTask.createMany({
      data: langs.map((lang) => ({
        jobId: job.id,
        targetType: input.targetType,
        targetId: input.targetId,
        lang,
        sourceContentHash: input.sourceContentHash,
        stage: SynthesisStage.TRANSLATE,
        status: SynthesisTaskStatus.COALESCED,
      })),
    });
    const tasks = await tx.synthesisTask.findMany({
      where: { jobId: job.id },
      orderBy: { lang: 'asc' },
      select: { id: true },
    });
    for (const task of tasks) {
      await this.tasks.activate(tx, await this.tasks.loadActivatable(tx, task.id), fx);
    }
    fx.jobChanged(job.id);
    return job.id;
  }

  private async supersede(tx: NarrationTx, fx: AfterCommit, input: NewJob): Promise<void> {
    const existing = await tx.synthesisJob.findMany({
      where: {
        targetType: input.targetType,
        targetId: input.targetId,
        status: { in: [...LIVE_JOB_STATUSES] },
      },
      select: { id: true, status: true, sourceContentHash: true },
    });
    const ids = jobsToSupersede(
      existing.map((job) => ({ ...job, status: job.status as SynthesisJobStatus })),
      input.sourceContentHash,
    );
    if (ids.length === 0) return;
    await tx.synthesisJob.updateMany({
      where: { id: { in: ids } },
      data: { status: SynthesisJobStatus.SUPERSEDED, finishedAt: new Date() },
    });
    await this.stopTasks(tx, fx, ids);
  }

  /** Cancels a stopped job's tasks: the active ones with promotion, the followers outright. */
  private async stopTasks(
    tx: NarrationTx,
    fx: AfterCommit,
    jobIds: readonly string[],
  ): Promise<void> {
    const active = await tx.synthesisTask.findMany({
      where: { jobId: { in: [...jobIds] }, status: { in: [...ACTIVE_TASK_STATUSES] } },
      select: { id: true, jobId: true, attempts: true },
    });
    for (const task of active) await this.tasks.cancelActive(tx, task, fx);
    await tx.synthesisTask.updateMany({
      where: { jobId: { in: [...jobIds] }, status: SynthesisTaskStatus.COALESCED },
      data: { status: SynthesisTaskStatus.CANCELLED, finishedAt: new Date() },
    });
    for (const id of jobIds) fx.jobChanged(id);
  }

  // ─── From catalog's events ────────────────────────────────────────────────────────────────

  /**
   * `catalog.place.content_changed` → a Place job, `vi` always included (rdm-spec C-4). An event for
   * text catalog no longer holds is skipped: its successor is on its way.
   */
  async fromPlaceContent(
    payload: EventPayload<typeof CATALOG_PLACE_CONTENT_CHANGED>,
    consumer: string,
  ): Promise<void> {
    const source = await this.catalog.localizationSource(
      LocalizationTargetType.PLACE,
      payload.placeId,
    );
    const current = liveSourceHash(source) === payload.contentHash;
    await this.tasks.transact(async (tx, fx) => {
      if (!(await this.firstDelivery(tx, consumer, payload.eventId)) || !current) return;
      await this.createJob(tx, fx, {
        targetType: LocalizationTargetType.PLACE,
        targetId: payload.placeId,
        sourceContentHash: payload.contentHash,
        langs: [SOURCE_LANGUAGE, ...payload.langs],
        includeAudio: true,
        trigger: payload.trigger,
      });
    });
  }

  /** `catalog.menu.content_changed` → one text-only job per item that still exists. */
  async fromMenuContent(
    payload: EventPayload<typeof CATALOG_MENU_CONTENT_CHANGED>,
    consumer: string,
  ): Promise<void> {
    const hashes = new Map<string, string>();
    for (const menuItemId of payload.menuItemIds) {
      const source = await this.catalog.localizationSource(
        LocalizationTargetType.MENU_ITEM,
        menuItemId,
      );
      const hash = source.menuItem?.contentHash ?? null;
      if (hash !== null) hashes.set(menuItemId, hash);
    }
    await this.tasks.transact(async (tx, fx) => {
      if (!(await this.firstDelivery(tx, consumer, payload.eventId))) return;
      for (const [menuItemId, hash] of hashes) {
        await this.createJob(tx, fx, {
          targetType: LocalizationTargetType.MENU_ITEM,
          targetId: menuItemId,
          sourceContentHash: hash,
          langs: payload.langs,
          includeAudio: false,
          trigger: SynthesisTrigger.CONTENT_CHANGED,
        });
      }
    });
  }

  /** Records the event for this consumer; false when it was already applied (rdm-spec §2.11). */
  private async firstDelivery(
    tx: NarrationTx,
    consumer: string,
    eventId: string,
  ): Promise<boolean> {
    const inserted = await tx.$executeRaw`
      INSERT INTO processed_events (consumer, event_id)
      VALUES (${consumer}, ${eventId}::uuid)
      ON CONFLICT DO NOTHING`;
    return inserted === 1;
  }

  // ─── The monitor (api-endpoints-plan §4.3) ────────────────────────────────────────────────

  async listJobs(
    request: narrationGrpc.ListJobsRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.ListJobsResponse> {
    requireAccountContext(context);
    const fields = parseRpcRequest(listFields, request);
    const where: Prisma.SynthesisJobWhereInput = {
      ...(fields.status === undefined
        ? {}
        : { status: requireProtoEnum(synthesisJobStatusProto, fields.status, '/status') }),
      ...(fields.targetType === undefined
        ? {}
        : {
            targetType: requireProtoEnum(
              localizationTargetTypeProto,
              fields.targetType,
              '/targetType',
            ),
          }),
      ...(fields.targetId === undefined ? {} : { targetId: fields.targetId }),
      ...(fields.trigger === undefined
        ? {}
        : { trigger: requireProtoEnum(synthesisTriggerProto, fields.trigger, '/trigger') }),
    };
    const { page, pageSize, sort } = fields.page;
    const [total, rows] = await Promise.all([
      this.prisma.synthesisJob.count({ where }),
      this.prisma.synthesisJob.findMany({
        where,
        orderBy: [{ createdAt: sort === 'createdAt' ? 'asc' : 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: JOB_SELECT,
      }),
    ]);
    return { jobs: rows.map(toSynthesisJob), page: { page, pageSize, total } };
  }

  async getJob(
    request: narrationGrpc.GetJobRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.GetJobResponse> {
    requireAccountContext(context);
    const { jobId } = parseRpcRequest(jobIdFields, request);
    const job = await this.prisma.synthesisJob.findUnique({
      where: { id: jobId },
      select: JOB_SELECT,
    });
    if (job === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'SYNTHESIS_JOB' });
    const tasks = await this.prisma.synthesisTask.findMany({
      where: { jobId },
      orderBy: [{ lang: 'asc' }],
      select: TASK_SELECT,
    });
    return { job: toSynthesisJob(job), tasks: tasks.map(toSynthesisTask) };
  }

  /** A staff regenerate: the source's current text, trigger `MANUAL`. */
  async createManualJob(
    request: narrationGrpc.CreateManualJobRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.CreateManualJobResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(manualFields, request);
    const targetType = requireProtoEnum(
      localizationTargetTypeProto,
      fields.targetType,
      '/targetType',
    );
    if (
      targetType !== LocalizationTargetType.PLACE &&
      targetType !== LocalizationTargetType.MENU_ITEM
    ) {
      throw rpcError('LOCALIZATION_TARGET_UNAVAILABLE');
    }
    if (fields.includeAudio && targetType !== LocalizationTargetType.PLACE)
      throw issue('/includeAudio');
    const hash = liveSourceHash(await this.catalog.localizationSource(targetType, fields.targetId));
    if (hash === null) throw rpcError('LOCALIZATION_TARGET_UNAVAILABLE');
    const jobId = await this.tasks.transact(async (tx, fx) => {
      const id = await this.createJob(tx, fx, {
        targetType,
        targetId: fields.targetId,
        sourceContentHash: hash,
        langs: fields.langs,
        includeAudio: fields.includeAudio,
        trigger: SynthesisTrigger.MANUAL,
        requestedByUserId: actor.userId,
      });
      await this.audit(tx, { type: AuditActorType.USER, userId: actor.userId }, context, {
        action: AuditAction.SYNTHESIS_JOB_CREATED,
        jobId: id,
        metadata: {
          after: {
            targetType,
            targetId: fields.targetId,
            trigger: SynthesisTrigger.MANUAL,
            langs: [...new Set(fields.langs)],
            includeAudio: fields.includeAudio,
          },
        },
      });
      return id;
    });
    return { job: await this.jobOf(jobId) };
  }

  /** Queued tasks wait — handed to a live follower when there is one; running tasks finish. */
  async pauseJob(
    request: narrationGrpc.PauseJobRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.PauseJobResponse> {
    return this.act(request, context, AuditAction.SYNTHESIS_JOB_PAUSED, async (tx, fx, job) => {
      if (job.status !== JOB_QUEUED && job.status !== JOB_RUNNING) {
        throw rpcError('SYNTHESIS_JOB_NOT_ACTIVE');
      }
      await tx.synthesisJob.update({
        where: { id: job.id },
        data: { status: SynthesisJobStatus.PAUSED },
        select: { id: true },
      });
      const queued = await tx.synthesisTask.findMany({
        where: { jobId: job.id, status: SynthesisTaskStatus.QUEUED },
        select: { id: true },
      });
      for (const task of queued) {
        await this.tasks.handOver(tx, await this.tasks.loadActivatable(tx, task.id), fx);
      }
    });
  }

  /** Waiting tasks run again; followers of a task no longer active are made active. */
  async resumeJob(
    request: narrationGrpc.ResumeJobRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.ResumeJobResponse> {
    return this.act(request, context, AuditAction.SYNTHESIS_JOB_RESUMED, async (tx, fx, job) => {
      if (job.status !== JOB_PAUSED) throw rpcError('SYNTHESIS_JOB_NOT_ACTIVE');
      await tx.synthesisJob.update({
        where: { id: job.id },
        data: { status: SynthesisJobStatus.QUEUED },
        select: { id: true },
      });
      const tasks = await tx.synthesisTask.findMany({
        where: {
          jobId: job.id,
          status: { in: [SynthesisTaskStatus.QUEUED, SynthesisTaskStatus.COALESCED] },
        },
        select: {
          id: true,
          status: true,
          attempts: true,
          coalescedInto: { select: { status: true } },
        },
      });
      for (const task of tasks) {
        if (task.status === TASK_QUEUED) {
          fx.enqueue({ taskId: task.id, attempts: task.attempts, priority: job.priority });
          continue;
        }
        const followed = task.coalescedInto?.status;
        if (
          followed === undefined ||
          !ACTIVE_TASK_STATUSES.includes(followed as SynthesisTaskStatus)
        ) {
          await this.tasks.activate(tx, await this.tasks.loadActivatable(tx, task.id), fx);
        }
      }
    });
  }

  /** Stops the job: no task of it publishes again, and a job following it carries on. */
  async cancelJob(
    request: narrationGrpc.CancelJobRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.CancelJobResponse> {
    const actor = requireAccountContext(context);
    return this.act(request, context, AuditAction.SYNTHESIS_JOB_CANCELLED, async (tx, fx, job) => {
      if (TERMINAL_JOB_STATUSES.includes(job.status as SynthesisJobStatus)) {
        throw rpcError('SYNTHESIS_JOB_NOT_ACTIVE');
      }
      await tx.synthesisJob.update({
        where: { id: job.id },
        data: {
          status: SynthesisJobStatus.CANCELLED,
          cancelledById: actor.userId,
          finishedAt: new Date(),
        },
        select: { id: true },
      });
      await this.stopTasks(tx, fx, [job.id]);
    });
  }

  /** New attempts for the failed tasks only, each from its recorded stage. */
  async retryFailedTasks(
    request: narrationGrpc.RetryFailedTasksRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.RetryFailedTasksResponse> {
    return this.act(request, context, AuditAction.SYNTHESIS_JOB_RETRIED, async (tx, fx, job) => {
      if (job.status !== JOB_PARTIALLY_FAILED && job.status !== JOB_FAILED) {
        throw rpcError('SYNTHESIS_JOB_NOT_ACTIVE');
      }
      const failed = await tx.synthesisTask.findMany({
        where: { jobId: job.id, status: SynthesisTaskStatus.FAILED },
        select: { id: true },
      });
      await tx.synthesisJob.update({
        where: { id: job.id },
        data: { status: SynthesisJobStatus.QUEUED, finishedAt: null, errorSummary: null },
        select: { id: true },
      });
      await tx.synthesisTask.updateMany({
        where: { id: { in: failed.map((task) => task.id) } },
        data: {
          status: SynthesisTaskStatus.COALESCED,
          coalescedIntoTaskId: null,
          attempts: 0,
          lastError: null,
          finishedAt: null,
        },
      });
      for (const task of failed) {
        await this.tasks.activate(tx, await this.tasks.loadActivatable(tx, task.id), fx);
      }
      return { after: { retriedTasks: failed.length } };
    });
  }

  listProviders(context: RequestContext): narrationGrpc.ListProvidersResponse {
    requireAccountContext(context);
    return {
      providers: this.providers.providers().map((provider) => ({
        ...provider,
        coolingUntil:
          provider.coolingUntil === null
            ? undefined
            : toProtoTimestamp(new Date(provider.coolingUntil)),
      })),
    };
  }

  async listVoices(context: RequestContext): Promise<narrationGrpc.ListVoicesResponse> {
    requireAccountContext(context);
    const voices = await this.providers.voices();
    return {
      voices: voices.map((catalogue) => ({
        lang: catalogue.lang,
        provider: catalogue.provider,
        pinnedVoiceId: catalogue.pinnedVoiceId ?? undefined,
        available: catalogue.available.map((voice) => ({
          id: voice.id,
          languageCode: voice.languageCode,
          gender: voice.gender ?? undefined,
        })),
      })),
    };
  }

  /**
   * One admin action on one job, under the job's row lock, audited with the status it found.
   * `change` may return extra audit metadata.
   */
  private async act(
    request: { jobId: string },
    context: RequestContext,
    action: AuditAction,
    change: (
      tx: NarrationTx,
      fx: AfterCommit,
      job: { id: string; status: string; priority: number },
    ) => Promise<AuditRecordPayload['metadata'] | void>,
  ): Promise<{ job: narrationGrpc.SynthesisJob }> {
    const actor: AccountContext = requireAccountContext(context);
    const { jobId } = parseRpcRequest(jobIdFields, request);
    await this.tasks.transact(async (tx, fx) => {
      const [job] = await tx.$queryRaw<{ id: string; status: string; priority: number }[]>`
        SELECT id, status, priority FROM synthesis_jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
      if (job === undefined) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'SYNTHESIS_JOB' });
      const extra = await change(tx, fx, job);
      fx.jobChanged(job.id);
      await this.audit(tx, { type: AuditActorType.USER, userId: actor.userId }, context, {
        action,
        jobId: job.id,
        metadata: extra ?? { before: { status: job.status } },
      });
    });
    return { job: await this.jobOf(jobId) };
  }

  /** Writes `audit.record` for a job (api-endpoints-plan §4.3). */
  async audit(
    tx: NarrationTx,
    actor: JobActor,
    context: RequestContext,
    record: { action: AuditAction; jobId: string; metadata: AuditRecordPayload['metadata'] },
  ): Promise<void> {
    await this.outbox.add(tx, AUDIT_RECORD, {
      occurredAt: new Date().toISOString(),
      service: 'narration',
      actor:
        actor.type === AuditActorType.USER
          ? { type: actor.type, userId: actor.userId }
          : { type: actor.type, deviceId: actor.deviceId },
      action: record.action,
      resource: { type: AuditResourceType.SYNTHESIS_JOB, id: record.jobId },
      metadata: record.metadata,
      ...(context.origin.ip === null ? {} : { ip: context.origin.ip }),
      ...(context.origin.userAgent === null ? {} : { userAgent: context.origin.userAgent }),
    });
  }

  private async jobOf(jobId: string): Promise<narrationGrpc.SynthesisJob> {
    return toSynthesisJob(
      await this.prisma.synthesisJob.findUniqueOrThrow({
        where: { id: jobId },
        select: JOB_SELECT,
      }),
    );
  }
}
