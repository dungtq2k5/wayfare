import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { BillingEventStatus } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookQueue } from '../webhook-queue/webhook-queue.module';
import { WEBHOOK_MAX_ATTEMPTS, WebhooksService } from '../webhooks/webhooks.service';

/** A `RECEIVED` row this old with no queue item lost its item. */
export const RECOVER_AFTER_MS = 60_000;

/** Rows one sweep looks at. */
const RECOVER_BATCH = 500;

/**
 * Re-adds `RECEIVED` events whose queue item was lost — a crash between the insert and the add, or
 * a queue that refused it (rdm-spec B-4). Runs at boot and every 5 minutes.
 */
@Injectable()
export class BillingWebhooksRecoverJob implements ScheduledJob, OnApplicationBootstrap {
  readonly name = 'billing-webhooks-recover';
  readonly everyMs = 5 * 60 * 1000;
  private readonly logger = new Logger(BillingWebhooksRecoverJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: WebhookQueue,
    private readonly webhooks: WebhooksService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.queue.runsWorker) return;
    await this.run(new Date()).catch((error: unknown) =>
      this.logger.error(
        { err: error instanceof Error ? error.message : 'unknown' },
        'boot recovery failed',
      ),
    );
  }

  async run(now: Date = new Date()): Promise<{ readded: number }> {
    const rows = await this.prisma.billingEvent.findMany({
      where: {
        status: BillingEventStatus.RECEIVED,
        receivedAt: { lt: new Date(now.getTime() - RECOVER_AFTER_MS) },
      },
      orderBy: { receivedAt: 'asc' },
      take: RECOVER_BATCH,
      select: { id: true },
    });
    let readded = 0;
    for (const row of rows) {
      if (await this.queue.has(row.id, WEBHOOK_MAX_ATTEMPTS)) continue;
      await this.webhooks.enqueue({ billingEventId: row.id, attempt: 1 });
      readded++;
    }
    return { readded };
  }
}
