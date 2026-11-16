import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { bullConnection } from './jobs.module';

/** What a work item's handler is given. */
export interface WorkItem<T> {
  readonly id: string;
  readonly data: T;
}

/** How a work queue is built. */
export interface WorkQueueOptions {
  /** The queue's name, `<service>-<work>`. */
  readonly name: string;
  readonly redisUrl: string;
  /** How many items this process runs at once. */
  readonly concurrency: number;
}

/**
 * A BullMQ queue for in-service work (ADR 0019, conventions §7.3). The service's own table is the
 * record: the queue keeps no finished items and never retries by itself, so a retry is the service
 * adding the item again. `add` removes any item with the same id first — BullMQ ignores an add for
 * an id it still holds, and a re-add must never be a silent no-op.
 */
export class WorkQueue<T> {
  private readonly logger = new Logger(WorkQueue.name);
  private readonly queue: Queue;
  private worker: Worker | null = null;

  constructor(private readonly options: WorkQueueOptions) {
    this.queue = new Queue(options.name, {
      connection: bullConnection(options.redisUrl, `${options.name}-queue`),
      defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 1 },
    });
  }

  /** Adds an item, replacing any with the same id. A lower priority runs first. */
  async add(
    id: string,
    data: T,
    options: { priority?: number; delayMs?: number } = {},
  ): Promise<void> {
    await this.remove(id);
    await this.queue.add(this.options.name, data, {
      jobId: id,
      ...(options.priority === undefined ? {} : { priority: options.priority }),
      ...(options.delayMs === undefined ? {} : { delay: options.delayMs }),
    });
  }

  /** Removes an item; one that is absent or already running is left alone. */
  async remove(id: string): Promise<void> {
    try {
      await this.queue.remove(id);
    } catch (error) {
      // A running item is locked; it finishes on its own.
      this.logger.debug(
        { id, err: error instanceof Error ? error.message : 'unknown' },
        'not removed',
      );
    }
  }

  /** Whether an item with this id is waiting, delayed or running. */
  async has(id: string): Promise<boolean> {
    return (await this.queue.getJob(id)) !== undefined;
  }

  /** Starts the worker. A handler that throws only logs: the service decides what a failure means. */
  start(handler: (item: WorkItem<T>) => Promise<void>): void {
    if (this.worker !== null) return;
    this.worker = new Worker<T>(
      this.options.name,
      async (job) => {
        try {
          await handler({ id: job.id!, data: job.data });
        } catch (error) {
          this.logger.error(
            { id: job.id, err: error instanceof Error ? error.message : 'unknown' },
            'work item failed',
          );
        }
      },
      {
        connection: bullConnection(this.options.redisUrl, `${this.options.name}-worker`),
        concurrency: this.options.concurrency,
      },
    );
    this.worker.on('error', (error) => this.logger.error({ err: error.message }, 'worker error'));
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }

  /** Empties the queue — tests only. */
  async drain(): Promise<void> {
    await this.queue.obliterate({ force: true });
  }
}
