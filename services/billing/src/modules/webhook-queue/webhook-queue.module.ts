import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkQueue } from '@wayfare/nest-common';
import type { WorkItem } from '@wayfare/nest-common';
import type { Env } from '../../config/env.schema';

/** One processing attempt of one recorded event: the row is the record (ADR 0019). */
export interface WebhookItem {
  readonly billingEventId: string;
  readonly attempt: number;
}

const WEBHOOK_QUEUE_OPTIONS = Symbol('WEBHOOK_QUEUE_OPTIONS');

/** Whether this process runs the webhook worker. */
interface WebhookQueueOptions {
  readonly worker: boolean;
}

/** Events processed at once per process. */
const WEBHOOK_CONCURRENCY = 4;

/**
 * The `billing-webhooks` queue: one item per attempt, id `<event>-<attempt>` — BullMQ refuses a `:`
 * in an id — so a retry added from inside a running attempt is never mistaken for it. BullMQ keeps
 * and retries nothing.
 */
@Injectable()
export class WebhookQueue implements OnApplicationShutdown {
  private readonly queue: WorkQueue<WebhookItem>;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(WEBHOOK_QUEUE_OPTIONS) private readonly options: WebhookQueueOptions,
  ) {
    this.queue = new WorkQueue<WebhookItem>({
      name: 'billing-webhooks',
      redisUrl: config.get('REDIS_URL', { infer: true }),
      concurrency: WEBHOOK_CONCURRENCY,
    });
  }

  add(item: WebhookItem, delayMs?: number): Promise<void> {
    return this.queue.add(
      `${item.billingEventId}-${item.attempt}`,
      item,
      delayMs === undefined ? {} : { delayMs },
    );
  }

  /** Whether any attempt of the event is waiting, delayed or running. */
  async has(billingEventId: string, attempts: number): Promise<boolean> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (await this.queue.has(`${billingEventId}-${attempt}`)) return true;
    }
    return false;
  }

  /** Whether this process runs the worker — and so the boot recovery sweep. */
  get runsWorker(): boolean {
    return this.options.worker;
  }

  /** Starts the worker, unless this process runs none (tests). */
  start(handler: (item: WorkItem<WebhookItem>) => Promise<void>): void {
    if (this.options.worker) this.queue.start(handler);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

/** The webhook queue, and whether this process works it. */
@Global()
@Module({})
export class WebhookQueueModule {
  static forRoot(options: WebhookQueueOptions): DynamicModule {
    return {
      module: WebhookQueueModule,
      providers: [{ provide: WEBHOOK_QUEUE_OPTIONS, useValue: options }, WebhookQueue],
      exports: [WebhookQueue],
    };
  }
}
