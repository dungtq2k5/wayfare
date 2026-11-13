import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { ScheduledJob } from '@wayfare/nest-common';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookQueue } from '../webhook-queue/webhook-queue.module';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Owner ids read per page — identity's `PAGE_SIZE_MAX`. */
const PAGE_LIMIT = 100;

/**
 * Opens a `FREE` account for any live, verified owner with none (rdm-spec B-3): the guarantee
 * behind `identity.owner.verified`, whose stream a retention window can outlive — a broker reset,
 * or an owner verified more than the stream's retention ago before this reconcile existed. Pages
 * `identity.OwnerService.ListVerifiedOwnerIds` and calls the same `openFreeAccount` the consumer
 * uses, idempotent on `owner_user_id`. Runs at boot and daily.
 */
@Injectable()
export class BillingAccountsReconcileJob implements ScheduledJob, OnApplicationBootstrap {
  readonly name = 'billing-accounts-reconcile';
  readonly everyMs = DAY_MS;
  private readonly logger = new Logger(BillingAccountsReconcileJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityServiceGrpcClient,
    private readonly entitlements: EntitlementsService,
    // No queue of its own; reused only for `runsWorker` — whether this process is the one meant to
    // do background work at all, the same question `BillingWebhooksRecoverJob` asks before its own
    // boot sweep, so a test booting the app never fires a live gRPC call to identity.
    private readonly queue: WebhookQueue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.queue.runsWorker) return;
    await this.run(new Date()).catch((error: unknown) =>
      this.logger.error(
        { err: error instanceof Error ? error.message : 'unknown' },
        'boot reconcile failed',
      ),
    );
  }

  async run(now: Date = new Date()): Promise<{ opened: number }> {
    let opened = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await this.identity.listVerifiedOwnerIds({ cursor, limit: PAGE_LIMIT });
      for (const ownerUserId of page.ownerUserIds) {
        const didOpen = await this.prisma.$transaction((tx) =>
          this.entitlements.openFreeAccount(tx, ownerUserId, now),
        );
        if (didOpen) opened++;
      }
      cursor = page.page?.nextCursor ?? undefined;
      if (cursor === undefined) return { opened };
    }
  }
}
