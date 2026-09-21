import { Injectable } from '@nestjs/common';
import {
  AccountRecoveryStatus,
  ActionTokenPurpose,
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  EmailTemplate,
} from '@wayfare/contracts';
import { OutboxService, SYSTEM_ORIGIN } from '@wayfare/nest-common';
import type { ScheduledJob } from '@wayfare/nest-common';
import { AccountLinksService } from '../account-links/account-links.service';
import { LIVE_RECOVERY_STATUSES } from '../admin-recoveries/domain/recovery-transitions';
import { auditRecord } from '../audit/domain/audit-record';
import { EmailDispatcher } from '../email/email.module';
import { EmailService } from '../email/email.service';
import type { PendingEmail } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

const MINUTE_MS = 60 * 1000;

/** How many cases one run moves; a run repeats until none is left. */
export const RECOVERY_ADVANCE_BATCH = 100;

/**
 * A recovery's clock (api-endpoints-plan §1.10, rdm-spec I-14): a hold that has passed sends the
 * link to the requested address, and a case nobody finished expires. Both live here, so the case's
 * time is kept in one place and a stopped service simply catches up at boot.
 */
@Injectable()
export class AccountRecoveriesAdvanceJob implements ScheduledJob {
  readonly name = 'account-recoveries-advance';
  readonly everyMs = 15 * MINUTE_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly links: AccountLinksService,
    private readonly email: EmailService,
    private readonly dispatcher: EmailDispatcher,
  ) {}

  async run(now: Date = new Date()): Promise<{ sent: number; expired: number }> {
    const sent = await this.sendLinks(now);
    const expired = await this.expire(now);
    return { sent, expired };
  }

  /** Every held case whose wait is over: the link goes to the address that was asked for. */
  private async sendLinks(now: Date): Promise<number> {
    const due = await this.prisma.accountRecovery.findMany({
      where: { status: AccountRecoveryStatus.ON_HOLD, holdUntil: { lte: now } },
      orderBy: { holdUntil: 'asc' },
      take: RECOVERY_ADVANCE_BATCH,
      select: { id: true },
    });
    const mails: PendingEmail[] = [];
    for (const { id } of due) {
      const mail = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM account_recoveries
          WHERE id = ${id}::uuid AND status = ${AccountRecoveryStatus.ON_HOLD}
            AND hold_until <= ${now} AND expires_at > ${now}
          FOR UPDATE SKIP LOCKED`;
        if (rows[0] === undefined) return null;
        const row = await tx.accountRecovery.update({
          where: { id },
          data: { status: AccountRecoveryStatus.LINK_SENT },
          select: { id: true, userId: true, requestedEmail: true },
        });
        const link = await this.links.mint(tx, {
          userId: row.userId,
          purpose: ActionTokenPurpose.ACCOUNT_RECOVERY,
          targetEmail: row.requestedEmail,
          origin: SYSTEM_ORIGIN,
          now,
        });
        // The mail goes to the address being claimed, carrying the link that finishes the move.
        // Its cancel link is the bare page: only the hash of the case's token is stored, and the
        // hold notice's link must keep working — it is the real owner's way to stop this.
        return this.email.prepare(tx, {
          template: EmailTemplate.ACCOUNT_RECOVERY_NOTICE,
          eventId: link.id,
          recipient: { userId: row.userId, email: row.requestedEmail },
          data: { recoveryId: row.id, stage: 'LINK_SENT' },
          links: {
            action: { path: 'completeRecovery', token: link.token },
            cancel: { path: 'cancelRecovery' },
          },
        });
      });
      if (mail !== null) mails.push(mail);
    }
    this.dispatcher.run(mails);
    return mails.length;
  }

  /** Every live case nobody finished in time. Its tokens die with it. */
  private async expire(now: Date): Promise<number> {
    const due = await this.prisma.accountRecovery.findMany({
      where: { status: { in: [...LIVE_RECOVERY_STATUSES] }, expiresAt: { lte: now } },
      orderBy: { expiresAt: 'asc' },
      take: RECOVERY_ADVANCE_BATCH,
      select: { id: true },
    });
    const mails: PendingEmail[] = [];
    for (const { id } of due) {
      const mail = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ status: string }[]>`
          SELECT status FROM account_recoveries
          WHERE id = ${id}::uuid AND expires_at <= ${now}
            AND status IN (${AccountRecoveryStatus.PENDING_APPROVAL},
                           ${AccountRecoveryStatus.ON_HOLD}, ${AccountRecoveryStatus.LINK_SENT})
          FOR UPDATE SKIP LOCKED`;
        const previous = rows[0]?.status;
        if (previous === undefined) return null;
        const row = await tx.accountRecovery.update({
          where: { id },
          data: { status: AccountRecoveryStatus.EXPIRED, cancelTokenHash: null },
          select: { id: true, userId: true },
        });
        await this.links.invalidate(tx, row.userId, [ActionTokenPurpose.ACCOUNT_RECOVERY], now);
        const audited = await this.outbox.add(
          tx,
          AUDIT_RECORD,
          auditRecord({
            now,
            actor: { type: AuditActorType.SYSTEM },
            action: AuditAction.ACCOUNT_RECOVERY_EXPIRED,
            resource: { type: AuditResourceType.ACCOUNT_RECOVERY, id: row.id },
            metadata: { before: { status: previous } },
            origin: SYSTEM_ORIGIN,
          }),
        );
        return this.email.prepare(tx, {
          template: EmailTemplate.ACCOUNT_RECOVERY_OUTCOME,
          eventId: audited.eventId,
          recipient: { userId: row.userId },
          data: { recoveryId: row.id, stage: 'EXPIRED' },
          links: { action: { path: 'signIn' } },
        });
      });
      if (mail !== null) mails.push(mail);
    }
    this.dispatcher.run(mails);
    return mails.length;
  }
}
