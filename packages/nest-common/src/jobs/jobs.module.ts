import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import type {
  DynamicModule,
  FactoryProvider,
  ModuleMetadata,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type { ReadinessCheck } from '../health/readiness';
import type { RawSqlTx } from '../prisma/helpers';
import { JobRunRecorder } from './job-run.recorder';

/**
 * One scheduled job (conventions §7.3): a `<subject>-<verb>.job.ts` class whose `run(now)` is what
 * the worker calls and what tests call directly.
 */
export interface ScheduledJob {
  /** The stable job id — an entry of the service's `SCHEDULED_JOBS`. */
  readonly name: string;
  /** How often it runs. */
  readonly everyMs: number;
  run(now: Date): Promise<unknown>;
}

/** What a service hands `JobsModule`. */
export interface JobsOptions {
  /** The service name; the queue is `<service>-jobs`. */
  readonly service: string;
  readonly redisUrl: string;
  /** Where runs are recorded (rdm-spec §2.12). */
  readonly db: RawSqlTx;
  readonly jobs: readonly ScheduledJob[];
  /** False in tests: nothing is scheduled and no worker starts. */
  readonly enabled: boolean;
}

const JOBS_OPTIONS = Symbol('JOBS_OPTIONS');

/** A `redis://` URL as BullMQ connection options. Workers need `maxRetriesPerRequest: null`. */
export function bullConnection(redisUrl: string, connectionName: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port: url.port === '' ? 6379 : Number(url.port),
    ...(url.username === '' ? {} : { username: decodeURIComponent(url.username) }),
    ...(url.password === '' ? {} : { password: decodeURIComponent(url.password) }),
    db,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    connectionName,
    maxRetriesPerRequest: null,
  };
}

/**
 * Schedules a service's repeatable jobs by stable id, runs one worker, records every run through
 * `JobRunRecorder`, and closes both on shutdown (conventions §7.3). Starts after the schema check,
 * in `onApplicationBootstrap`.
 */
@Injectable()
export class JobScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobScheduler.name);
  private readonly queue: Queue | null;
  private worker: Worker | null = null;
  private readonly recorder: JobRunRecorder;

  constructor(@Inject(JOBS_OPTIONS) private readonly options: JobsOptions) {
    this.recorder = new JobRunRecorder(options.db);
    this.queue = options.enabled
      ? new Queue(this.queueName, {
          connection: bullConnection(options.redisUrl, `${options.service}-jobs`),
        })
      : null;
  }

  private get queueName(): string {
    return `${this.options.service}-jobs`;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.queue === null) return;
    const wanted = new Map(this.options.jobs.map((job) => [job.name, job]));
    // A job removed from the code must stop firing.
    for (const scheduler of await this.queue.getJobSchedulers()) {
      if (!wanted.has(scheduler.key)) await this.queue.removeJobScheduler(scheduler.key);
    }
    for (const job of wanted.values()) {
      await this.queue.upsertJobScheduler(
        job.name,
        { every: job.everyMs },
        { name: job.name, opts: { removeOnComplete: 100, removeOnFail: 100 } },
      );
    }
    this.worker = new Worker(
      this.queueName,
      async (bullJob) => {
        const job = wanted.get(bullJob.name);
        if (job === undefined) {
          this.logger.warn({ job: bullJob.name }, 'unknown scheduled job ignored');
          return;
        }
        await this.recorder.track(job.name, () => job.run(new Date()));
      },
      {
        connection: bullConnection(this.options.redisUrl, `${this.options.service}-worker`),
        concurrency: 1,
      },
    );
    this.worker.on('error', (error) => this.logger.error({ err: error.message }, 'worker error'));
  }

  /** Readiness: the queue's Redis answers. Always ready when jobs are disabled. */
  readinessCheck(): ReadinessCheck {
    return {
      name: 'redis',
      check: async () => {
        if (this.queue === null) return;
        // Any command answered proves the connection.
        await this.queue.getJobSchedulersCount();
      },
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}

/** The BullMQ wiring every service with scheduled jobs imports (conventions §7.3). */
@Module({})
export class JobsModule {
  static forRootAsync(options: {
    imports?: ModuleMetadata['imports'];
    inject?: FactoryProvider['inject'];
    useFactory: (...args: never[]) => JobsOptions | Promise<JobsOptions>;
  }): DynamicModule {
    return {
      module: JobsModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        {
          provide: JOBS_OPTIONS,
          inject: options.inject ?? [],
          useFactory: options.useFactory,
        },
        JobScheduler,
      ],
      exports: [JobScheduler],
    };
  }
}
