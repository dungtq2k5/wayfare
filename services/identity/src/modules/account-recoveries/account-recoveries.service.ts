import { Injectable } from '@nestjs/common';
import {
  AccountRecoveryStatus,
  ACTION_TOKEN_PURPOSES,
  ActionTokenPurpose,
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  EmailTemplate,
  NotificationType,
  SessionRevokedReason,
  zCancelRecoveryInput,
  zCompleteRecoveryInput,
  zUuidV7,
} from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { hashToken, OutboxService, parseRpcRequest, rpcError } from '@wayfare/nest-common';
import type { RequestContext, RequestOrigin } from '@wayfare/nest-common';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client';
import { AccountLinksService } from '../account-links/account-links.service';
import { allows } from '../admin-recoveries/domain/recovery-transitions';
import { RECOVERY_SELECT } from '../admin-recoveries/recovery.mapper';
import type { RecoveryRow } from '../admin-recoveries/recovery.mapper';
import { auditRecord } from '../audit/domain/audit-record';
import { EmailDispatcher } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { TokensService } from '../tokens/tokens.service';

const recoveryIdField = z.object({ recoveryId: zUuidV7 });

/**
 * The owner's side of account recovery (api-endpoints-plan §1.10). Both routes are public and take
 * a secret, so **every refusal is the same `410`**: a wrong token, a spent one, a case that is not
 * live, and a signed-in stranger all learn exactly nothing about whether a case exists.
 */
@Injectable()
export class AccountRecoveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly links: AccountLinksService,
    private readonly sessions: SessionsService,
    private readonly tokens: TokensService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly dispatcher: EmailDispatcher,
  ) {}

  /**
   * "This wasn't me." The case's own owner may stop it signed in; anyone else needs the token from
   * a hold notice. Nothing about the account changes either way — it never had.
   */
  async cancelRecovery(
    request: identityGrpc.CancelRecoveryRequest,
    context: RequestContext,
  ): Promise<identityGrpc.CancelRecoveryResponse> {
    const { recoveryId } = parseRpcRequest(recoveryIdField, request);
    const { token } = parseRpcRequest(zCancelRecoveryInput, { token: request.token ?? undefined });
    const signedInUserId = context.kind === 'account' ? context.userId : null;
    const now = new Date();

    const outcome = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockLive(tx, recoveryId);
      const bySignedInOwner = signedInUserId !== null && signedInUserId === row.userId;
      // A token, or the owner themselves. A signed-in stranger is refused like a bad token. The
      // hash is read on its own: it is a secret, and the staff view never carries it.
      if (!bySignedInOwner) {
        const secret = await tx.accountRecovery.findUniqueOrThrow({
          where: { id: recoveryId },
          select: { cancelTokenHash: true },
        });
        if (token === undefined || secret.cancelTokenHash !== hashToken(token)) {
          throw rpcError('TOKEN_EXPIRED');
        }
      }
      const cancelled = await tx.accountRecovery.update({
        where: { id: recoveryId },
        data: { status: AccountRecoveryStatus.CANCELLED, cancelTokenHash: null },
        select: RECOVERY_SELECT,
      });
      const audited = await this.outbox.add(
        tx,
        AUDIT_RECORD,
        auditRecord({
          now,
          actor: bySignedInOwner
            ? { type: AuditActorType.USER, userId: row.userId }
            : { type: AuditActorType.SYSTEM },
          action: AuditAction.ACCOUNT_RECOVERY_CANCELLED_BY_OWNER,
          resource: { type: AuditResourceType.ACCOUNT_RECOVERY, id: recoveryId },
          metadata: { after: { bySignedInOwner } },
          origin: context.origin,
        }),
      );
      const mail = await this.email.prepare(tx, {
        template: EmailTemplate.ACCOUNT_RECOVERY_OUTCOME,
        eventId: audited.eventId,
        recipient: { userId: cancelled.userId },
        data: { recoveryId, stage: 'CANCELLED' },
        links: { action: { path: 'signIn' } },
      });
      return { mail };
    });
    this.dispatcher.run([outcome.mail]);
    return {};
  }

  /**
   * The link sent to the requested address, spent with a new password (api-endpoints-plan §1.10).
   * One transaction sets and verifies the address, writes the password, ends every session, stamps
   * `credentials_changed_at` and closes the case — and **invalidates every other live link of the
   * account**, the revert above all: a revert token was minted to the address that was lost, and
   * consuming it later would hand the account straight back (rdm-spec I-14).
   */
  async completeRecovery(
    request: identityGrpc.CompleteRecoveryRequest,
    context: RequestContext,
  ): Promise<identityGrpc.CompleteRecoveryResponse> {
    const fields = parseRpcRequest(zCompleteRecoveryInput, {
      token: request.token,
      newPassword: request.newPassword,
    });
    // Hashed outside the transaction: argon2 is deliberately slow.
    const passwordHash = await this.tokens.hashPassword(fields.newPassword);
    const now = new Date();

    const outcome = await this.prisma.$transaction(async (tx) => {
      const link = await this.links.consume(tx, fields.token, [
        ActionTokenPurpose.ACCOUNT_RECOVERY,
      ]);
      const row = await this.liveCaseFor(tx, link.userId, link.targetEmail);
      if (!allows('complete', row.status)) throw rpcError('TOKEN_EXPIRED');
      const taken = await tx.user.findUnique({
        where: { email: link.targetEmail },
        select: { id: true },
      });
      if (taken !== null) throw rpcError('EMAIL_TAKEN');

      const previous = await tx.user.findUniqueOrThrow({
        where: { id: link.userId },
        select: { email: true },
      });
      await tx.user.update({
        where: { id: link.userId },
        data: {
          email: link.targetEmail,
          isEmailVerified: true,
          emailBouncedAt: null,
          passwordHash,
          credentialsChangedAt: now,
        },
        select: { id: true },
      });
      await this.sessions.revokeAllForUser(tx, link.userId, SessionRevokedReason.PASSWORD_CHANGED, {
        bumpCutoff: true,
        now,
      });
      // Every other live link of this account dies here, whichever address it went to.
      await this.links.invalidate(tx, link.userId, OTHER_PURPOSES, now);
      const completed = await tx.accountRecovery.update({
        where: { id: row.id },
        data: {
          status: AccountRecoveryStatus.COMPLETED,
          completedAt: now,
          cancelTokenHash: null,
        },
        select: RECOVERY_SELECT,
      });
      const audited = await this.audit(
        tx,
        now,
        AuditAction.ACCOUNT_RECOVERY_COMPLETED,
        completed.id,
        row.status,
        context.origin,
        link.userId,
      );
      const delivered = await this.notifications.deliver(tx, {
        recipientUserId: link.userId,
        eventId: audited.eventId,
        notification: {
          type: NotificationType.ACCOUNT_RECOVERY_COMPLETED,
          data: { recoveryId: completed.id },
        },
      });
      // Both addresses: whoever lost the old one learns what happened either way.
      const mails = [
        await this.email.prepare(tx, {
          template: EmailTemplate.ACCOUNT_RECOVERY_OUTCOME,
          eventId: audited.eventId,
          recipient: { userId: link.userId },
          data: { recoveryId: completed.id, stage: 'COMPLETED' },
          links: { action: { path: 'signIn' } },
        }),
        await this.email.prepare(tx, {
          template: EmailTemplate.ACCOUNT_RECOVERY_OUTCOME,
          eventId: audited.eventId,
          recipient: { email: previous.email },
          data: { recoveryId: completed.id, stage: 'COMPLETED' },
          links: { action: { path: 'signIn' } },
        }),
      ];
      return { delivered, mails };
    });
    if (outcome.delivered.inserted) await this.notifications.announce(outcome.delivered.row);
    this.dispatcher.run(outcome.mails);
    return {};
  }

  /** The live case of this user for this address, locked. Anything else is the uniform `410`. */
  private async liveCaseFor(
    tx: Prisma.TransactionClient,
    userId: string,
    requestedEmail: string,
  ): Promise<RecoveryRow> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM account_recoveries
      WHERE user_id = ${userId}::uuid AND requested_email = ${requestedEmail}
        AND status = ${AccountRecoveryStatus.LINK_SENT}
      FOR UPDATE`;
    const id = rows[0]?.id;
    if (id === undefined) throw rpcError('TOKEN_EXPIRED');
    return tx.accountRecovery.findUniqueOrThrow({ where: { id }, select: RECOVERY_SELECT });
  }

  /** A live case, locked. A case that is finished, or absent, answers as a bad token would. */
  private async lockLive(tx: Prisma.TransactionClient, recoveryId: string): Promise<RecoveryRow> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM account_recoveries WHERE id = ${recoveryId}::uuid FOR UPDATE`;
    if (rows[0] === undefined) throw rpcError('TOKEN_EXPIRED');
    const row = await tx.accountRecovery.findUniqueOrThrow({
      where: { id: recoveryId },
      select: RECOVERY_SELECT,
    });
    if (!allows('cancel', row.status)) throw rpcError('TOKEN_EXPIRED');
    return row;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    now: Date,
    action: AuditAction,
    recoveryId: string,
    previousStatus: string,
    origin: RequestOrigin,
    userId: string,
  ): Promise<{ eventId: string }> {
    return this.outbox.add(
      tx,
      AUDIT_RECORD,
      auditRecord({
        now,
        actor: { type: AuditActorType.USER, userId },
        action,
        resource: { type: AuditResourceType.ACCOUNT_RECOVERY, id: recoveryId },
        metadata: { before: { status: previousStatus } },
        origin,
      }),
    );
  }
}

/** Every purpose but the one being spent: they all die when a recovery completes. */
const OTHER_PURPOSES = ACTION_TOKEN_PURPOSES.filter(
  (purpose) => purpose !== ActionTokenPurpose.ACCOUNT_RECOVERY,
);
