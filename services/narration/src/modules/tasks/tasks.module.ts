import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAX_CONCURRENT_TTS_JOBS } from '@wayfare/contracts';
import { WorkQueue } from '@wayfare/nest-common';
import type { WorkItem } from '@wayfare/nest-common';
import type { Env } from '../../config/env.schema';
import { ProvidersHealthModule } from '../providers-health/providers-health.module';
import { queueItemId } from './domain/after-commit';
import { TasksService } from './tasks.service';

/** What a queue item carries: the task id only — the row is the record (ADR 0019). */
export interface TaskItem {
  readonly taskId: string;
}

const TASK_QUEUE_OPTIONS = Symbol('TASK_QUEUE_OPTIONS');

/** Whether this process runs the synthesis worker. */
interface TaskQueueOptions {
  readonly worker: boolean;
}

/**
 * The synthesis queue: one item per task attempt, at `SYNTHESIS_CONCURRENCY` (rdm-spec N-1, N-2).
 * Items carry the task id only, and BullMQ keeps and retries nothing.
 */
@Injectable()
export class TaskQueue implements OnApplicationShutdown {
  private readonly queue: WorkQueue<TaskItem>;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(TASK_QUEUE_OPTIONS) private readonly options: TaskQueueOptions,
  ) {
    this.queue = new WorkQueue<TaskItem>({
      name: 'narration-synthesis',
      redisUrl: config.get('REDIS_URL', { infer: true }),
      concurrency: config.get('SYNTHESIS_CONCURRENCY', { infer: true }) ?? MAX_CONCURRENT_TTS_JOBS,
    });
  }

  add(taskId: string, attempts: number, priority: number, delayMs?: number): Promise<void> {
    return this.queue.add(queueItemId(taskId, attempts), { taskId }, { priority, delayMs });
  }

  remove(taskId: string, attempts: number): Promise<void> {
    return this.queue.remove(queueItemId(taskId, attempts));
  }

  has(taskId: string, attempts: number): Promise<boolean> {
    return this.queue.has(queueItemId(taskId, attempts));
  }

  /** Whether this process runs the worker — and so the boot recovery sweep. */
  get runsWorker(): boolean {
    return this.options.worker;
  }

  /** Starts the worker, unless this process runs none (tests). */
  start(handler: (item: WorkItem<TaskItem>) => Promise<void>): void {
    if (this.options.worker) this.queue.start(handler);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

/** The synthesis pipeline (rdm-spec N-1 to N-5): the queue, and the service that runs each task. */
@Global()
@Module({})
export class TasksModule {
  static forRoot(options: TaskQueueOptions): DynamicModule {
    return {
      module: TasksModule,
      imports: [ProvidersHealthModule],
      providers: [{ provide: TASK_QUEUE_OPTIONS, useValue: options }, TaskQueue, TasksService],
      exports: [TaskQueue, TasksService, ProvidersHealthModule],
    };
  }
}
