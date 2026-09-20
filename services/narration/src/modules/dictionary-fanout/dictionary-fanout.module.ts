import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkQueue } from '@wayfare/nest-common';
import type { WorkItem } from '@wayfare/nest-common';
import type { Env } from '../../config/env.schema';
import { CatalogModule } from '../catalog/catalog.module';
import { JobsModule } from '../jobs/jobs.module';
import { DictionaryFanoutService } from './dictionary-fanout.service';
import type { FanoutItem, FanoutQueuePort } from './domain/fanout-queue';

const FANOUT_QUEUE_OPTIONS = Symbol('FANOUT_QUEUE_OPTIONS');

/** Whether this process runs the fan-out worker. */
interface FanoutQueueOptions {
  readonly worker: boolean;
}

/** The dictionary fan-out queue: one item per changed term, worked one at a time. */
@Injectable()
export class FanoutQueue implements FanoutQueuePort, OnApplicationShutdown {
  private readonly queue: WorkQueue<FanoutItem>;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(FANOUT_QUEUE_OPTIONS) private readonly options: FanoutQueueOptions,
  ) {
    this.queue = new WorkQueue<FanoutItem>({
      name: 'narration-dictionary-fanout',
      redisUrl: config.get('REDIS_URL', { infer: true }),
      concurrency: 1,
    });
  }

  /** Queues a term's fan-out; a repeat for the same term and position replaces the waiting one. */
  add(item: FanoutItem, delayMs?: number): Promise<void> {
    const id = `${item.term}:${item.langs.join(',')}:${item.attempt}`;
    return this.queue.add(id, item, { ...(delayMs === undefined ? {} : { delayMs }) });
  }

  start(handler: (item: WorkItem<FanoutItem>) => Promise<void>): void {
    if (this.options.worker) this.queue.start(handler);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

/** The `DICTIONARY_CHANGED` fan-out (rdm-spec N-5): the queue, and the worker that pages it. */
@Global()
@Module({})
export class DictionaryFanoutModule {
  static forRoot(options: FanoutQueueOptions): DynamicModule {
    return {
      module: DictionaryFanoutModule,
      imports: [CatalogModule, JobsModule],
      providers: [
        { provide: FANOUT_QUEUE_OPTIONS, useValue: options },
        FanoutQueue,
        DictionaryFanoutService,
      ],
      exports: [FanoutQueue, DictionaryFanoutService],
    };
  }
}
