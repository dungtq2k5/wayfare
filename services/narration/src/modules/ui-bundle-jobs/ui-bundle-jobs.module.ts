import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkQueue } from '@wayfare/nest-common';
import type { WorkItem } from '@wayfare/nest-common';
import type { Env } from '../../config/env.schema';
import { UiBundleJobsService } from './ui-bundle-jobs.service';
import type { BundleItem, BundleQueuePort } from './domain/bundle-queue';

const BUNDLE_QUEUE_OPTIONS = Symbol('BUNDLE_QUEUE_OPTIONS');

/** Whether this process runs the bundle worker. */
interface BundleQueueOptions {
  readonly worker: boolean;
}

/** The UI bundle queue: one item per namespace, locale and source version, worked one at a time. */
@Injectable()
export class BundleQueue implements BundleQueuePort, OnApplicationShutdown {
  private readonly queue: WorkQueue<BundleItem>;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(BUNDLE_QUEUE_OPTIONS) private readonly options: BundleQueueOptions,
  ) {
    this.queue = new WorkQueue<BundleItem>({
      name: 'narration-ui-bundles',
      redisUrl: config.get('REDIS_URL', { infer: true }),
      concurrency: 1,
    });
  }

  /**
   * Queues a bundle; a repeat of the same one at the same attempt replaces the waiting item. The
   * id is dash-joined: BullMQ refuses a custom id whose colons do not split it in three.
   */
  add(item: BundleItem, delayMs?: number): Promise<void> {
    const id = `${item.namespace}-${item.locale}-${item.sourceHash}-${item.attempt}`;
    return this.queue.add(id, item, { ...(delayMs === undefined ? {} : { delayMs }) });
  }

  start(handler: (item: WorkItem<BundleItem>) => Promise<void>): void {
    if (this.options.worker) this.queue.start(handler);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

/** Machine-translated UI bundles (rdm-spec N-6): the queue, and the worker that fills them. */
@Global()
@Module({})
export class UiBundleJobsModule {
  static forRoot(options: BundleQueueOptions): DynamicModule {
    return {
      module: UiBundleJobsModule,
      providers: [
        { provide: BUNDLE_QUEUE_OPTIONS, useValue: options },
        BundleQueue,
        UiBundleJobsService,
      ],
      exports: [BundleQueue, UiBundleJobsService],
    };
  }
}
