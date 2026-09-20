import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import {
  compareStrings,
  JOB_HEARTBEAT_MS,
  LocalizationTargetType,
  MAX_FAILURE_REASON_LENGTH,
  MAX_LOCALIZED_TEXT_LENGTH,
  MAX_MENU_ITEM_DESCRIPTION_LENGTH,
  MAX_MENU_ITEM_NAME_LENGTH,
  MAX_PLACE_NAME_LENGTH,
  NARRATION_LOCALIZATION_FAILED,
  NARRATION_LOCALIZATION_READY,
  OverrideStatus,
  SOURCE_LANGUAGE,
  SYNTHESIS_RETRY_BACKOFF_MS,
  SYNTHESIS_TASK_ATTEMPTS,
  SynthesisJobStatus,
  SynthesisStage,
  SynthesisTaskStatus,
  TranslationSource,
} from '@wayfare/contracts';
import type { EventInput, Language } from '@wayfare/contracts';
import { OutboxService } from '@wayfare/nest-common';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import { Counter } from 'prom-client';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import type { Prisma } from '../../../generated/prisma/client';
import { voiceFor } from '../../config/voices';
import { InputRefusedError, redact } from '../../providers/provider-chain';
import type { SpeechProvider, VoiceSpec } from '../../providers/speech/speech-provider';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import {
  ACTIVE_TASK_STATUSES,
  isTerminalJobStatus,
  jobStatusFrom,
} from '../jobs/domain/job-status';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressService } from '../progress/progress.service';
import { ProvidersHealthService } from '../providers-health/providers-health.service';
import { afterCommit } from './domain/after-commit';
import type { AfterCommit } from './domain/after-commit';
import { audioCacheKey, translationCacheKey } from './domain/cache-keys';
import { joinMp3 } from './domain/mp3';
import { placeSsmlBody, splitSsml, wholeSsml } from './domain/ssml';
import type { PronunciationRule } from './domain/ssml';
import { TaskQueue } from './tasks.module';

/** A narration transaction. */
export type NarrationTx = Prisma.TransactionClient;

/** The cache policy of a stored audio file: content-addressed, so immutable (architecture §3.6). */
const AUDIO_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** What a task needs to be made active: its key, its attempt and its job's priority. */
const ACTIVATABLE_SELECT = {
  id: true,
  jobId: true,
  targetType: true,
  targetId: true,
  lang: true,
  sourceContentHash: true,
  attempts: true,
  job: { select: { priority: true, status: true } },
} as const;

/** A task as `activate` takes it. */
export type ActivatableTask = Prisma.SynthesisTaskGetPayload<{ select: typeof ACTIVATABLE_SELECT }>;

/** A running task, with what the pipeline reads of its job. */
const RUN_SELECT = {
  ...ACTIVATABLE_SELECT,
  stage: true,
  job: { select: { priority: true, status: true, includeAudio: true } },
} as const;

type RunningTask = Prisma.SynthesisTaskGetPayload<{ select: typeof RUN_SELECT }>;

/** A task's text in its language, and where it came from. */
interface LocalizedText {
  readonly name: string;
  readonly description: string | null;
  readonly source: TranslationSource;
  /** The provider that translated a field, when one did. */
  readonly provider: string | null;
}

/** The source as catalog holds it now, or gone. */
type Source =
  | { readonly kind: 'gone' }
  | { readonly kind: 'text'; readonly name: string; readonly description: string | null };

/** A stored or found audio file, as `ready` carries it. */
interface Audio {
  readonly assetId: string;
  readonly objectPath: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly durationMs: number;
  readonly voiceId: string;
}

// Widened: statuses, stages and kinds are read from the database as plain strings.
const QUEUED: string = SynthesisTaskStatus.QUEUED;
const RUNNING: string = SynthesisTaskStatus.RUNNING;
const COALESCED: string = SynthesisTaskStatus.COALESCED;
const PAUSED: string = SynthesisJobStatus.PAUSED;
const TRANSLATE: string = SynthesisStage.TRANSLATE;
const PLACE: string = LocalizationTargetType.PLACE;

const LIVE_UNPAUSED = new Set<string>([SynthesisJobStatus.QUEUED, SynthesisJobStatus.RUNNING]);

/** `text` cut to `max` UTF-16 units, never inside a surrogate pair. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** A failure's reason as it may be stored and published: short, and never a response body. */
function reasonOf(error: unknown): string {
  return clamp(redact(error), MAX_FAILURE_REASON_LENGTH) || 'unknown';
}

/**
 * The synthesis pipeline (rdm-spec N-1 to N-5). The task row is the record: each stage is written
 * as it is reached, and a retry resumes there, reusing the translation and audio caches.
 *
 * One task per key `(target, lang, source hash)` is active at a time: every path that makes a task
 * active goes through `activate` under the key's advisory lock, and the others follow it
 * (`COALESCED`) and finish with it.
 */
/** Cached audio rows whose object was gone, so the task synthesized again (rdm-spec N-3). */
const audioCacheMissingTotal = new Counter({
  name: 'narration_audio_cache_missing_total',
  help: 'Audio cache hits whose stored object was missing, re-synthesized.',
});

@Injectable()
export class TasksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly catalog: CatalogServiceGrpcClient,
    private readonly providers: ProvidersHealthService,
    private readonly progress: ProgressService,
    private readonly queue: TaskQueue,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  onApplicationBootstrap(): void {
    this.queue.start((item) => this.run(item.data.taskId));
  }

  // ─── Making tasks active (the task-key lock) ──────────────────────────────────────────────

  /** Serializes every change to one key's active task, until the transaction ends. */
  async lockKey(
    tx: NarrationTx,
    key: {
      readonly targetType: string;
      readonly targetId: string | null;
      readonly lang: string;
      readonly sourceContentHash: string;
    },
  ): Promise<void> {
    const name = [key.targetType, key.targetId ?? '', key.lang, key.sourceContentHash].join(':');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
  }

  /** A task as `activate` takes it. */
  loadActivatable(tx: NarrationTx, taskId: string): Promise<ActivatableTask> {
    return tx.synthesisTask.findUniqueOrThrow({
      where: { id: taskId },
      select: ACTIVATABLE_SELECT,
    });
  }

  /**
   * Makes a task active or has it follow the active one (rdm-spec N-2). The same function serves
   * creation, retry, resume and promotion. A waiting task of a paused job gives its slot away.
   */
  async activate(tx: NarrationTx, task: ActivatableTask, fx: AfterCommit): Promise<void> {
    await this.lockKey(tx, task);
    const active = await tx.synthesisTask.findFirst({
      where: {
        targetType: task.targetType,
        targetId: task.targetId,
        lang: task.lang,
        sourceContentHash: task.sourceContentHash,
        status: { in: [...ACTIVE_TASK_STATUSES] },
        id: { not: task.id },
      },
      select: {
        id: true,
        jobId: true,
        status: true,
        attempts: true,
        job: { select: { status: true } },
      },
    });
    fx.jobChanged(task.jobId);
    if (active === null) {
      await this.makeQueued(tx, task, fx);
      return;
    }
    if (active.status === QUEUED && active.job.status === PAUSED) {
      // The paused job's task steps aside and follows the new one, so its job completes on resume.
      await tx.synthesisTask.update({
        where: { id: active.id },
        data: { status: SynthesisTaskStatus.COALESCED, coalescedIntoTaskId: null },
        select: { id: true },
      });
      fx.dequeue(active);
      await this.makeQueued(tx, task, fx);
      await tx.synthesisTask.updateMany({
        where: {
          OR: [{ id: active.id }, { coalescedIntoTaskId: active.id }],
          status: SynthesisTaskStatus.COALESCED,
        },
        data: { coalescedIntoTaskId: task.id },
      });
      fx.jobChanged(active.jobId);
      return;
    }
    await tx.synthesisTask.update({
      where: { id: task.id },
      data: { status: SynthesisTaskStatus.COALESCED, coalescedIntoTaskId: active.id },
      select: { id: true },
    });
  }

  private async makeQueued(tx: NarrationTx, task: ActivatableTask, fx: AfterCommit): Promise<void> {
    await tx.synthesisTask.update({
      where: { id: task.id },
      data: { status: SynthesisTaskStatus.QUEUED, coalescedIntoTaskId: null },
      select: { id: true },
    });
    // A paused job's task holds its slot without a queue item; resume adds it.
    if (task.job.status !== PAUSED) {
      fx.enqueue({ taskId: task.id, attempts: task.attempts, priority: task.job.priority });
    }
  }

  /**
   * After an active task was cancelled or handed over: the oldest follower whose job is live and
   * not paused becomes active, and the others follow it. Returns the task they now follow, or null
   * when no follower could take over (a paused job's follower is re-homed on resume).
   */
  async promote(tx: NarrationTx, fromTaskId: string, fx: AfterCommit): Promise<string | null> {
    const followers = await tx.synthesisTask.findMany({
      where: { coalescedIntoTaskId: fromTaskId, status: SynthesisTaskStatus.COALESCED },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: ACTIVATABLE_SELECT,
    });
    const candidate = followers.find((follower) => LIVE_UNPAUSED.has(follower.job.status));
    if (candidate === undefined) return null;
    await this.activate(tx, candidate, fx);
    const after = await tx.synthesisTask.findUniqueOrThrow({
      where: { id: candidate.id },
      select: { status: true, coalescedIntoTaskId: true },
    });
    const head = after.status === COALESCED ? after.coalescedIntoTaskId! : candidate.id;
    await tx.synthesisTask.updateMany({
      where: { coalescedIntoTaskId: fromTaskId, status: SynthesisTaskStatus.COALESCED },
      data: { coalescedIntoTaskId: head },
    });
    return head;
  }

  /** Cancels an active task and promotes a follower. False when it was no longer active. */
  async cancelActive(
    tx: NarrationTx,
    task: { readonly id: string; readonly jobId: string; readonly attempts: number },
    fx: AfterCommit,
  ): Promise<boolean> {
    const { count } = await tx.synthesisTask.updateMany({
      where: { id: task.id, status: { in: [...ACTIVE_TASK_STATUSES] } },
      data: { status: SynthesisTaskStatus.CANCELLED, finishedAt: new Date() },
    });
    if (count === 0) return false;
    fx.dequeue(task);
    fx.jobChanged(task.jobId);
    await this.promote(tx, task.id, fx);
    return true;
  }

  /**
   * A paused job's waiting task: handed to a live follower when there is one — the follower runs,
   * and this task follows it — else it keeps its slot with no queue item (rdm-spec N-2).
   */
  async handOver(tx: NarrationTx, task: ActivatableTask, fx: AfterCommit): Promise<void> {
    await this.lockKey(tx, task);
    fx.dequeue(task);
    const follower = await tx.synthesisTask.findFirst({
      where: {
        coalescedIntoTaskId: task.id,
        status: SynthesisTaskStatus.COALESCED,
        job: { status: { in: [SynthesisJobStatus.QUEUED, SynthesisJobStatus.RUNNING] } },
      },
      select: { id: true },
    });
    if (follower === null) return;
    await tx.synthesisTask.update({
      where: { id: task.id },
      data: { status: SynthesisTaskStatus.COALESCED, coalescedIntoTaskId: null },
      select: { id: true },
    });
    const head = await this.promote(tx, task.id, fx);
    await tx.synthesisTask.update({
      where: { id: task.id },
      data: { coalescedIntoTaskId: head },
      select: { id: true },
    });
  }

  /**
   * Ends a running task, and every task following it the same way (rdm-spec N-2). False when the
   * task was no longer running — cancelled meanwhile.
   */
  private async finish(
    tx: NarrationTx,
    task: RunningTask,
    outcome: SynthesisTaskStatus.SUCCEEDED | SynthesisTaskStatus.FAILED,
    data: Prisma.SynthesisTaskUncheckedUpdateManyInput,
    fx: AfterCommit,
  ): Promise<boolean> {
    const now = new Date();
    const { count } = await tx.synthesisTask.updateMany({
      where: { id: task.id, status: SynthesisTaskStatus.RUNNING },
      data: { ...data, status: outcome, finishedAt: now },
    });
    if (count === 0) return false;
    fx.jobChanged(task.jobId);
    fx.taskChanged({
      jobId: task.jobId,
      lang: task.lang,
      stage: typeof data.stage === 'string' ? data.stage : task.stage,
      status: outcome,
    });
    const followers = await tx.synthesisTask.findMany({
      where: { coalescedIntoTaskId: task.id, status: SynthesisTaskStatus.COALESCED },
      select: { jobId: true },
    });
    const copied = {
      translationProvider: data.translationProvider,
      speechProvider: data.speechProvider,
      voiceId: data.voiceId,
      cacheKey: data.cacheKey,
      audioAssetId: data.audioAssetId,
      lastError: data.lastError,
    };
    await tx.synthesisTask.updateMany({
      where: { coalescedIntoTaskId: task.id, status: SynthesisTaskStatus.COALESCED },
      data: { ...copied, status: outcome, finishedAt: now },
    });
    for (const follower of followers) fx.jobChanged(follower.jobId);
    if (outcome === SynthesisTaskStatus.FAILED && typeof data.lastError === 'string') {
      await tx.synthesisJob.updateMany({
        where: { id: { in: [task.jobId, ...followers.map((follower) => follower.jobId)] } },
        data: { errorSummary: `${task.lang}: ${data.lastError}` },
      });
    }
    return true;
  }

  // ─── Jobs' counts and statuses ────────────────────────────────────────────────────────────

  /** Recomputes every changed job's counts and status (rdm-spec N-1). Call last in a transaction. */
  async settle(tx: NarrationTx, fx: AfterCommit): Promise<void> {
    if (fx.jobs.size === 0) return;
    // Locked in id order before counting: two tasks of one job finishing at once would otherwise
    // each count the other as still running, and leave the job RUNNING for good.
    const jobIds = [...fx.jobs].toSorted(compareStrings);
    await tx.$queryRaw`
      SELECT id FROM synthesis_jobs WHERE id = ANY(${jobIds}::uuid[]) ORDER BY id FOR UPDATE`;
    for (const jobId of jobIds) {
      const job = await tx.synthesisJob.findUnique({
        where: { id: jobId },
        select: { status: true, startedAt: true, finishedAt: true },
      });
      if (job === null) continue;
      const grouped = await tx.synthesisTask.groupBy({
        by: ['status'],
        where: { jobId },
        _count: { _all: true },
      });
      const counts: Partial<Record<SynthesisTaskStatus, number>> = {};
      for (const row of grouped) counts[row.status as SynthesisTaskStatus] = row._count._all;
      const status = jobStatusFrom(job.status as SynthesisJobStatus, counts);
      const now = new Date();
      await tx.synthesisJob.update({
        where: { id: jobId },
        data: {
          status,
          completedTasks: counts[SynthesisTaskStatus.SUCCEEDED] ?? 0,
          failedTasks: counts[SynthesisTaskStatus.FAILED] ?? 0,
          ...(status === SynthesisJobStatus.RUNNING && job.startedAt === null
            ? { startedAt: now }
            : {}),
          ...(isTerminalJobStatus(status) && job.finishedAt === null ? { finishedAt: now } : {}),
        },
        select: { id: true },
      });
    }
  }

  /** After the commit: the queue changes, then the monitor's frames. Never throws. */
  async flush(fx: AfterCommit): Promise<void> {
    for (const item of fx.removes.values()) {
      await this.queue
        .remove(item.taskId, item.attempts)
        .catch((error: unknown) => this.warn('remove', error));
    }
    for (const item of fx.adds.values()) {
      await this.queue
        .add(item.taskId, item.attempts, item.priority, item.delayMs)
        // A lost add is found again by the recovery sweep.
        .catch((error: unknown) => this.warn('add', error));
    }
    for (const change of fx.tasks) this.progress.taskProgress(change);
    if (fx.jobs.size === 0) return;
    const jobs = await this.prisma.synthesisJob
      .findMany({
        where: { id: { in: [...fx.jobs] } },
        select: {
          id: true,
          targetType: true,
          targetId: true,
          status: true,
          completedTasks: true,
          failedTasks: true,
          totalTasks: true,
        },
      })
      .catch(() => []);
    for (const job of jobs) this.progress.jobStatus(job);
  }

  /** Runs `fn` in a transaction, settles the jobs it touched, and flushes after the commit. */
  async transact<T>(fn: (tx: NarrationTx, fx: AfterCommit) => Promise<T>): Promise<T> {
    const fx = afterCommit();
    const result = await this.prisma.$transaction(async (tx) => {
      const value = await fn(tx, fx);
      await this.settle(tx, fx);
      return value;
    });
    await this.flush(fx);
    return result;
  }

  // ─── Running a task ───────────────────────────────────────────────────────────────────────

  /** Runs one task attempt: the queue worker's handler, and what tests call directly. */
  async run(taskId: string): Promise<void> {
    const task = await this.claim(taskId);
    if (task === null) return;
    const heartbeat = setInterval(() => void this.beat(task.jobId), JOB_HEARTBEAT_MS);
    heartbeat.unref();
    try {
      await this.execute(task);
    } catch (error) {
      await this.failAttempt(task, error).catch((failure: unknown) =>
        this.logger.error({ taskId, err: reasonOf(failure) }, 'could not record a task failure'),
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** `QUEUED → RUNNING`, unless another worker has it or its job stopped. */
  private claim(taskId: string): Promise<RunningTask | null> {
    return this.transact(async (tx, fx) => {
      const task = await tx.synthesisTask.findUnique({ where: { id: taskId }, select: RUN_SELECT });
      if (task === null) return null;
      const jobStatus = task.job.status as SynthesisJobStatus;
      // A paused job's task waits with no queue item; resume adds it again.
      if (jobStatus === SynthesisJobStatus.PAUSED) return null;
      if (!LIVE_UNPAUSED.has(jobStatus)) {
        await this.cancelActive(tx, task, fx);
        return null;
      }
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE synthesis_tasks
        SET status = 'RUNNING', started_at = COALESCE(started_at, now()), updated_at = now()
        WHERE id = ${taskId}::uuid AND status = 'QUEUED'
        RETURNING id`;
      if (claimed.length === 0) return null;
      await tx.synthesisJob.update({
        where: { id: task.jobId },
        data: { heartbeatAt: new Date() },
        select: { id: true },
      });
      fx.jobChanged(task.jobId);
      fx.taskChanged({
        jobId: task.jobId,
        lang: task.lang,
        stage: task.stage,
        status: SynthesisTaskStatus.RUNNING,
      });
      return task;
    });
  }

  private async beat(jobId: string): Promise<void> {
    await this.prisma.synthesisJob
      .updateMany({
        where: { id: jobId, status: SynthesisJobStatus.RUNNING },
        data: { heartbeatAt: new Date() },
      })
      .catch((error: unknown) => this.warn('heartbeat', error));
  }

  /**
   * Runs `fn` in a transaction only while the task still runs in a live, unpaused job. A paused
   * job's task goes back to waiting at its stage; a stopped job's task is cancelled. Returns false
   * when `fn` did not run: the task stops there, and never publishes.
   */
  private guarded(
    task: RunningTask,
    fn: (tx: NarrationTx, fx: AfterCommit) => Promise<void>,
  ): Promise<boolean> {
    return this.transact(async (tx, fx) => {
      const now = await tx.synthesisTask.findUnique({
        where: { id: task.id },
        select: { status: true, job: { select: { status: true } } },
      });
      if (now?.status !== RUNNING) return false;
      if (now.job.status === PAUSED) {
        await tx.synthesisTask.update({
          where: { id: task.id },
          data: { status: SynthesisTaskStatus.QUEUED },
          select: { id: true },
        });
        fx.jobChanged(task.jobId);
        return false;
      }
      if (!LIVE_UNPAUSED.has(now.job.status)) {
        await this.cancelActive(tx, task, fx);
        return false;
      }
      await fn(tx, fx);
      return true;
    });
  }

  /** Records a stage and who answered, and reports it. */
  private async advance(
    task: RunningTask,
    stage: SynthesisStage,
    data: Prisma.SynthesisTaskUncheckedUpdateManyInput = {},
  ): Promise<void> {
    await this.prisma.synthesisTask.updateMany({
      where: { id: task.id, status: SynthesisTaskStatus.RUNNING },
      data: { ...data, stage },
    });
    (task as { stage: string }).stage = stage;
    this.progress.taskProgress({
      jobId: task.jobId,
      lang: task.lang,
      stage,
      status: SynthesisTaskStatus.RUNNING,
    });
  }

  private async execute(task: RunningTask): Promise<void> {
    const source = await this.readSource(task);
    if (source.kind === 'gone') {
      // A newer event is on its way, and its job supersedes this one.
      await this.transact((tx, fx) => this.cancelActive(tx, task, fx));
      return;
    }
    const firstPass = task.stage === TRANSLATE;
    const text = await this.translate(task, source);
    const isPlace = task.targetType === PLACE;
    const voiced = isPlace && task.job.includeAudio;
    const speakers = voiced ? this.speakersFor(task.lang) : [];

    const carryOn = await this.guarded(task, async (tx, fx) => {
      if (text.provider !== null) {
        await tx.synthesisTask.update({
          where: { id: task.id },
          data: { translationProvider: text.provider },
          select: { id: true },
        });
      }
      if (!voiced) {
        // A menu item, or a Place asked for text only: publish once, and done.
        if (text.source !== TranslationSource.HUMAN || !isPlace)
          await this.publishReady(tx, task, text, null);
        await this.finish(tx, task, SynthesisTaskStatus.SUCCEEDED, {}, fx);
        return;
      }
      if (speakers.length === 0) {
        // No voice for this language: text-only, reported in the same transaction, text first.
        if (text.source !== TranslationSource.HUMAN) await this.publishReady(tx, task, text, null);
        await this.outbox.add(tx, NARRATION_LOCALIZATION_FAILED, {
          occurredAt: new Date().toISOString(),
          targetType: LocalizationTargetType.PLACE,
          targetId: task.targetId!,
          lang: task.lang,
          stage: SynthesisStage.SYNTHESIZE,
          reason: 'NO_VOICE',
          final: true,
        });
        await this.finish(
          tx,
          task,
          SynthesisTaskStatus.SUCCEEDED,
          { stage: SynthesisStage.SYNTHESIZE, lastError: 'NO_VOICE' },
          fx,
        );
        return;
      }
      // A machine translation is served as soon as it exists; its audio follows.
      if (firstPass && text.source === TranslationSource.MACHINE) {
        await this.publishReady(tx, task, text, null);
      }
    });
    if (!carryOn || !voiced || speakers.length === 0) return;

    await this.advance(task, SynthesisStage.PRONOUNCE);
    const body = placeSsmlBody({
      name: text.name,
      description: text.description ?? '',
      lang: task.lang,
      rules: await this.rulesFor(task.lang),
    });

    await this.advance(task, SynthesisStage.SYNTHESIZE);
    const audio =
      (await this.findAudio(task, body, speakers)) ?? (await this.synthesize(task, body));

    const published = await this.guarded(task, async (tx, fx) => {
      await tx.audioAsset.update({
        where: { id: audio.assetId },
        data: { lastReferencedAt: new Date() },
        select: { id: true },
      });
      await this.publishReady(tx, task, text, audio);
      await this.finish(
        tx,
        task,
        SynthesisTaskStatus.SUCCEEDED,
        { stage: SynthesisStage.PUBLISH, audioAssetId: audio.assetId },
        fx,
      );
    });
    if (!published) this.logger.log({ taskId: task.id }, 'task stopped before publishing');
  }

  /** The target's source as catalog holds it now (api-endpoints-plan §12.2). */
  private async readSource(task: RunningTask): Promise<Source> {
    const response = await this.catalog.localizationSource(
      task.targetType as LocalizationTargetType,
      task.targetId!,
    );
    const place = response.place ?? null;
    if (place !== null) {
      if (place.deleted || place.contentHash !== task.sourceContentHash) return { kind: 'gone' };
      return { kind: 'text', name: place.nameVi, description: place.descriptionVi };
    }
    const item = response.menuItem ?? null;
    if (item !== null) {
      if (item.contentHash !== task.sourceContentHash) return { kind: 'gone' };
      return { kind: 'text', name: item.nameVi, description: item.descriptionVi ?? null };
    }
    return { kind: 'gone' };
  }

  /** The text in the task's language: a staff correction, the source itself, or a translation. */
  private async translate(
    task: RunningTask,
    source: Source & { kind: 'text' },
  ): Promise<LocalizedText> {
    const isPlace = task.targetType === PLACE;
    const nameMax = isPlace ? MAX_PLACE_NAME_LENGTH : MAX_MENU_ITEM_NAME_LENGTH;
    const descriptionMax = isPlace ? MAX_LOCALIZED_TEXT_LENGTH : MAX_MENU_ITEM_DESCRIPTION_LENGTH;
    const shaped = (
      name: string,
      description: string | null,
      origin: TranslationSource,
      provider: string | null,
    ): LocalizedText => ({
      name: clamp(name, nameMax),
      description:
        description === null || description === '' ? null : clamp(description, descriptionMax),
      source: origin,
      provider,
    });

    if (task.lang === SOURCE_LANGUAGE) {
      return shaped(source.name, source.description, TranslationSource.SOURCE, null);
    }
    const override = await this.prisma.localizationOverride.findFirst({
      where: {
        targetType: task.targetType,
        targetId: task.targetId!,
        lang: task.lang,
        sourceContentHash: task.sourceContentHash,
        status: OverrideStatus.ACTIVE,
      },
      select: { name: true, description: true },
    });
    const name =
      override === null
        ? await this.translateField(task.lang, source.name)
        : { text: override.name, provider: null };
    const description =
      override?.description != null
        ? { text: override.description, provider: null }
        : source.description === null || source.description === ''
          ? null
          : await this.translateField(task.lang, source.description);
    return shaped(
      name.text,
      description?.text ?? null,
      override === null ? TranslationSource.MACHINE : TranslationSource.HUMAN,
      description?.provider ?? name.provider,
    );
  }

  /** One field through the translation cache (rdm-spec N-4), then the chain on a miss. */
  private async translateField(
    lang: string,
    text: string,
  ): Promise<{ text: string; provider: string | null }> {
    const cacheKey = translationCacheKey({ sourceLang: SOURCE_LANGUAGE, targetLang: lang, text });
    const cached = await this.prisma.translationCache.findUnique({
      where: { cacheKey },
      select: { translatedText: true, provider: true },
    });
    if (cached !== null) {
      await this.prisma.translationCache.update({
        where: { cacheKey },
        data: { lastUsedAt: new Date() },
        select: { cacheKey: true },
      });
      return { text: cached.translatedText, provider: cached.provider };
    }
    const chain = this.providers.chains.translation;
    const to = lang as Language;
    if (!chain.providers.some((provider) => provider.supports(to))) {
      throw new InputRefusedError('UNSUPPORTED_LANGUAGE');
    }
    const { result, provider } = await chain.run(
      (candidate) => candidate.supports(to),
      (candidate) => candidate.translate({ text, from: SOURCE_LANGUAGE, to }),
    );
    await this.prisma.translationCache.createMany({
      data: [
        {
          cacheKey,
          sourceLang: SOURCE_LANGUAGE,
          targetLang: lang,
          translatedText: result,
          provider: provider.name,
          sourceChars: text.length,
        },
      ],
      skipDuplicates: true,
    });
    return { text: result, provider: provider.name };
  }

  /** The configured speech providers with a pinned voice for `lang`, in chain order. */
  private speakersFor(lang: string): { provider: SpeechProvider; voice: VoiceSpec }[] {
    return this.providers.chains.speech.providers.flatMap((provider) => {
      const voice = voiceFor(provider.name, lang);
      return voice === null ? [] : [{ provider, voice }];
    });
  }

  /** The active dictionary entries for `lang` and for every language (rdm-spec N-5). */
  private async rulesFor(lang: string): Promise<PronunciationRule[]> {
    if (lang === SOURCE_LANGUAGE) return [];
    const rows = await this.prisma.pronunciationEntry.findMany({
      where: { isActive: true, OR: [{ targetLang: lang }, { targetLang: null }] },
      select: {
        term: true,
        targetLang: true,
        replacementType: true,
        replacement: true,
        alphabet: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      replacementType: row.replacementType as 'SUB' | 'PHONEME',
    }));
  }

  /** A stored file for this SSML under any configured provider's voice and format: a cache hit. */
  private async findAudio(
    task: RunningTask,
    body: string,
    speakers: readonly { provider: SpeechProvider; voice: VoiceSpec }[],
  ): Promise<Audio | null> {
    const ssml = wholeSsml(body);
    for (const { provider, voice } of speakers) {
      const cacheKey = audioCacheKey({
        ssml,
        lang: task.lang,
        voiceId: voice.id,
        format: provider.format,
      });
      const asset = await this.prisma.audioAsset.findUnique({
        where: { cacheKey },
        select: {
          id: true,
          objectPath: true,
          sha256: true,
          bytes: true,
          durationMs: true,
          voiceId: true,
        },
      });
      if (asset === null) continue;
      // The row is a claim about a file in a bucket, and the two can disagree — a lost bucket, a
      // lifecycle rule, a mistaken delete (rdm-spec N-3). A definite not-found is a miss, so the
      // task synthesizes and stores again over the same path. Any other storage failure is the
      // task's failure: an unreachable bucket must not re-synthesize every cache hit.
      if ((await this.storage.stat(asset.objectPath)) === null) {
        audioCacheMissingTotal.inc();
        this.logger.warn(
          { cacheKey, objectPath: asset.objectPath, audioAssetId: asset.id },
          'a cached audio object is gone; synthesizing again',
        );
        continue;
      }
      await this.advance(task, SynthesisStage.PUBLISH, {
        speechProvider: provider.name,
        voiceId: voice.id,
        cacheKey,
        audioAssetId: asset.id,
      });
      return {
        assetId: asset.id,
        objectPath: asset.objectPath,
        sha256: asset.sha256,
        bytes: asset.bytes,
        durationMs: asset.durationMs,
        voiceId: asset.voiceId,
      };
    }
    return null;
  }

  /** Synthesizes the SSML chunk by chunk through the chain, joins and stores it (rdm-spec N-3). */
  private async synthesize(task: RunningTask, body: string): Promise<Audio> {
    const { result, provider } = await this.providers.chains.speech.run(
      (candidate) => voiceFor(candidate.name, task.lang) !== null,
      async (candidate) => {
        const voice = voiceFor(candidate.name, task.lang)!;
        const split = splitSsml(body, candidate.maxInputBytes);
        if (!split.ok) throw new InputRefusedError(split.reason);
        const parts: Buffer[] = [];
        for (const ssml of split.chunks) {
          const part = await candidate.synthesize({ ssml, voice });
          if (part.length === 0) throw new Error('empty result');
          parts.push(part);
        }
        return { parts, voice };
      },
    );
    const ssml = wholeSsml(body);
    const cacheKey = audioCacheKey({
      ssml,
      lang: task.lang,
      voiceId: result.voice.id,
      format: provider.format,
    });
    await this.advance(task, SynthesisStage.STORE, {
      speechProvider: provider.name,
      voiceId: result.voice.id,
      cacheKey,
    });

    const joined = joinMp3(result.parts);
    if (!joined.ok) throw new Error(`the provider's audio is not MP3: ${joined.reason}`);
    const objectPath = `audio/${cacheKey}.mp3`;
    await this.storage.upload(objectPath, joined.data, {
      contentType: 'audio/mpeg',
      cacheControl: AUDIO_CACHE_CONTROL,
    });
    // A concurrent task may have stored the same file: the first row stays.
    await this.prisma.audioAsset.createMany({
      data: [
        {
          cacheKey,
          lang: task.lang,
          voiceId: result.voice.id,
          provider: provider.name,
          format: provider.format,
          objectPath,
          sha256: createHash('sha256').update(joined.data).digest('hex'),
          bytes: joined.data.length,
          durationMs: joined.durationMs,
          ssmlChars: ssml.length,
        },
      ],
      skipDuplicates: true,
    });
    const asset = await this.prisma.audioAsset.findUniqueOrThrow({
      where: { cacheKey },
      select: {
        id: true,
        objectPath: true,
        sha256: true,
        bytes: true,
        durationMs: true,
        voiceId: true,
      },
    });
    await this.advance(task, SynthesisStage.PUBLISH, { audioAssetId: asset.id });
    return {
      assetId: asset.id,
      objectPath: asset.objectPath,
      sha256: asset.sha256,
      bytes: asset.bytes,
      durationMs: asset.durationMs,
      voiceId: asset.voiceId,
    };
  }

  /** Writes `narration.localization.ready` for the task's key (api-endpoints-plan §10). */
  private async publishReady(
    tx: NarrationTx,
    task: RunningTask,
    text: LocalizedText,
    audio: Audio | null,
  ): Promise<void> {
    const isPlace = task.targetType === PLACE;
    const input: EventInput<typeof NARRATION_LOCALIZATION_READY> = {
      occurredAt: new Date().toISOString(),
      targetType: isPlace ? LocalizationTargetType.PLACE : LocalizationTargetType.MENU_ITEM,
      targetId: task.targetId!,
      lang: task.lang,
      sourceContentHash: task.sourceContentHash,
      translationSource: text.source,
      text: isPlace
        ? { name: text.name, description: text.description ?? text.name }
        : {
            name: text.name,
            ...(text.description === null ? {} : { description: text.description }),
          },
      ...(audio === null ? {} : { audio: { ...audio, sourceContentHash: task.sourceContentHash } }),
    };
    await this.outbox.add(tx, NARRATION_LOCALIZATION_READY, input);
  }

  /**
   * A failed attempt (rdm-spec N-2): counted, reported with `final: false`, and retried after the
   * backoff from its recorded stage — or, after the last attempt or a refused input, `FAILED` with
   * its followers, reported `final: true`.
   */
  private async failAttempt(task: RunningTask, error: unknown): Promise<void> {
    const reason = reasonOf(error);
    const refused = error instanceof InputRefusedError;
    this.logger.warn({ taskId: task.id, stage: task.stage, err: reason }, 'task attempt failed');
    await this.transact(async (tx, fx) => {
      const now = await tx.synthesisTask.findUnique({
        where: { id: task.id },
        select: { status: true, attempts: true, stage: true, job: { select: { status: true } } },
      });
      if (now?.status !== RUNNING) return;
      const jobStatus = now.job.status as SynthesisJobStatus;
      if (jobStatus !== SynthesisJobStatus.PAUSED && !LIVE_UNPAUSED.has(jobStatus)) {
        await this.cancelActive(tx, task, fx);
        return;
      }
      const attempts = now.attempts + 1;
      const final = refused || attempts >= SYNTHESIS_TASK_ATTEMPTS;
      await this.outbox.add(tx, NARRATION_LOCALIZATION_FAILED, {
        occurredAt: new Date().toISOString(),
        targetType:
          task.targetType === PLACE
            ? LocalizationTargetType.PLACE
            : LocalizationTargetType.MENU_ITEM,
        targetId: task.targetId!,
        lang: task.lang,
        stage: now.stage as SynthesisStage,
        reason,
        final,
      });
      if (final) {
        await this.finish(
          tx,
          { ...task, stage: now.stage },
          SynthesisTaskStatus.FAILED,
          { attempts, lastError: reason },
          fx,
        );
        return;
      }
      await tx.synthesisTask.update({
        where: { id: task.id },
        data: { status: SynthesisTaskStatus.QUEUED, attempts, lastError: reason },
        select: { id: true },
      });
      fx.jobChanged(task.jobId);
      fx.taskChanged({
        jobId: task.jobId,
        lang: task.lang,
        stage: now.stage,
        status: SynthesisTaskStatus.QUEUED,
      });
      if (jobStatus !== SynthesisJobStatus.PAUSED) {
        const backoff =
          SYNTHESIS_RETRY_BACKOFF_MS[Math.min(attempts, SYNTHESIS_RETRY_BACKOFF_MS.length) - 1]!;
        fx.enqueue({ taskId: task.id, attempts, priority: task.job.priority, delayMs: backoff });
      }
    });
  }

  private warn(what: string, error: unknown): void {
    this.logger.warn({ err: reasonOf(error) }, `synthesis queue ${what} failed`);
  }
}
