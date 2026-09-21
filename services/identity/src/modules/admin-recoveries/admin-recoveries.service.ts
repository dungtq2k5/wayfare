import { Injectable } from '@nestjs/common';
import {
  AccountRecoveryStatus,
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  EmailTemplate,
  NotificationType,
  RECOVERY_EXPIRY_DAYS,
  RECOVERY_HOLD_HOURS,
  RecoveryEvidenceCode,
  zOpenRecoveryInput,
  zRecoveryQuery,
  zRejectRecoveryInput,
  zUuidV7,
} from '@wayfare/contracts';
import { accountRecoveryStatusProto, recoveryEvidenceCodeProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  generateToken,
  hashToken,
  isUniqueConstraintViolation,
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client';
import { auditRecord } from '../audit/domain/audit-record';
import { EmailDispatcher } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { allows } from './domain/recovery-transitions';
import { RECOVERY_SELECT, toRecovery } from './recovery.mapper';
import type { RecoveryRow } from './recovery.mapper';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Whether a database error is the named check constraint refusing the write. */
function violates(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.includes(constraint)
  );
}

const userIdField = z.object({ userId: zUuidV7 });
const recoveryIdField = z.object({ recoveryId: zUuidV7 });

/**
 * The staff side of account recovery (api-endpoints-plan §1.10, rdm-spec I-14). The gateway checks
 * the route's permission; identity checks what only it can know — that the subject is a live,
 * verified owner, that the evidence is enough, that one case is live at a time, and that nobody
 * approves the case they opened.
 *
 * **Nothing reaches the owner until approval:** until then support is still checking, and a false
 * case must not be able to alarm someone or, worse, kill a link they are using.
 */
@Injectable()
export class AdminRecoveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly dispatcher: EmailDispatcher,
  ) {}

  /** Opens a case. The requested address may be taken; that is refused at completion, not here. */
  async openRecovery(
    request: identityGrpc.OpenRecoveryRequest,
    context: RequestContext,
  ): Promise<identityGrpc.OpenRecoveryResponse> {
    const actor = requireAccountContext(context);
    const { userId } = parseRpcRequest(userIdField, request);
    const input = parseRpcRequest(zOpenRecoveryInput, {
      requestedEmail: request.requestedEmail,
      evidenceCodes: request.evidenceCodes.map((code) => recoveryEvidenceCodeProto.fromProto(code)),
      supportReference: request.supportReference,
    });
    this.requireEvidence(input.evidenceCodes);

    const subject = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ownerVerifiedAt: true, deletedAt: true },
    });
    if (subject === null || subject.deletedAt !== null || subject.ownerVerifiedAt === null) {
      throw rpcError('INVALID_STATE', { status: 'NOT_AN_OWNER' });
    }

    const now = new Date();
    const row = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.accountRecovery.create({
          data: {
            userId,
            status: AccountRecoveryStatus.PENDING_APPROVAL,
            requestedEmail: input.requestedEmail,
            evidenceCodes: [...input.evidenceCodes],
            supportReference: input.supportReference,
            openedById: actor.userId,
            expiresAt: new Date(now.getTime() + RECOVERY_EXPIRY_DAYS * DAY_MS),
          },
          select: RECOVERY_SELECT,
        });
        await this.audit(tx, actor, now, AuditAction.ACCOUNT_RECOVERY_OPENED, created.id, {
          // The codes and the ticket; never the requested address (rdm-spec I-14).
          after: {
            evidenceCodes: [...input.evidenceCodes],
            supportReference: input.supportReference,
          },
        });
        return created;
      })
      .catch((error: unknown) => {
        // The one-live index is the enforcement; the check above is only the message
        // (conventions §8.5). The evidence constraint backs `requireEvidence` the same way.
        if (isUniqueConstraintViolation(error)) {
          throw rpcError('INVALID_STATE', { status: 'RECOVERY_ALREADY_LIVE' });
        }
        if (violates(error, 'account_recoveries_evidence_ck')) {
          throw rpcError('RECOVERY_EVIDENCE_INSUFFICIENT');
        }
        throw error;
      });
    return { recovery: toRecovery(row) };
  }

  /** The queue, a page at a time; newest first. */
  async listRecoveries(
    request: identityGrpc.ListRecoveriesRequest,
    context: RequestContext,
  ): Promise<identityGrpc.ListRecoveriesResponse> {
    requireAccountContext(context);
    const status = accountRecoveryStatusProto.fromProto(request.status);
    // No `q`: the queue is not searched, and the schema is strict — a key it does not declare is
    // a refusal even when its value is undefined.
    const query = parseRpcRequest(zRecoveryQuery, {
      page: request.page?.page,
      pageSize: request.page?.pageSize,
      ...(status === null ? {} : { status }),
    });
    const where = query.status === undefined ? {} : { status: query.status };
    const [total, rows] = await Promise.all([
      this.prisma.accountRecovery.count({ where }),
      this.prisma.accountRecovery.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: RECOVERY_SELECT,
      }),
    ]);
    return {
      recoveries: rows.map(toRecovery),
      page: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  /**
   * Approval starts the hold: the case is `ON_HOLD` for `RECOVERY_HOLD_HOURS`, the cancel token is
   * minted, and the owner is told on every channel identity has. Nothing about the account changes.
   */
  async approveRecovery(
    request: identityGrpc.ApproveRecoveryRequest,
    context: RequestContext,
  ): Promise<identityGrpc.ApproveRecoveryResponse> {
    const actor = requireAccountContext(context);
    const { recoveryId } = parseRpcRequest(recoveryIdField, request);
    const now = new Date();
    const holdUntil = new Date(now.getTime() + RECOVERY_HOLD_HOURS * HOUR_MS);
    const token = generateToken();

    const outcome = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, recoveryId);
      if (current.openedById === actor.userId) throw rpcError('RECOVERY_SELF_APPROVAL');
      if (!allows('approve', current.status)) {
        throw rpcError('INVALID_STATE', { status: current.status });
      }
      const row = await tx.accountRecovery.update({
        where: { id: recoveryId },
        data: {
          status: AccountRecoveryStatus.ON_HOLD,
          approvedById: actor.userId,
          holdUntil,
          cancelTokenHash: hashToken(token),
        },
        select: RECOVERY_SELECT,
      });
      const audited = await this.audit(
        tx,
        actor,
        now,
        AuditAction.ACCOUNT_RECOVERY_APPROVED,
        recoveryId,
        { after: { holdUntil: holdUntil.toISOString() } },
      );
      const delivered = await this.notifications.deliver(tx, {
        recipientUserId: row.userId,
        eventId: audited.eventId,
        notification: {
          type: NotificationType.ACCOUNT_RECOVERY_PENDING,
          data: { recoveryId, holdUntil: holdUntil.toISOString() },
        },
      });
      // The old address, which is the one the real owner still reads if this is a takeover.
      const mail = await this.email.prepare(tx, {
        template: EmailTemplate.ACCOUNT_RECOVERY_NOTICE,
        eventId: audited.eventId,
        recipient: { userId: row.userId },
        data: { recoveryId, stage: 'HOLD_STARTED', holdUntil: holdUntil.toISOString() },
        links: {
          action: { path: 'cancelRecovery', token },
          cancel: { path: 'cancelRecovery', token },
        },
      });
      return { row, delivered, mail };
    });
    if (outcome.delivered.inserted) await this.notifications.announce(outcome.delivered.row);
    this.dispatcher.run([outcome.mail]);
    return { recovery: toRecovery(outcome.row) };
  }

  /** Rejection ends the case with its note, and tells the owner it is over. */
  async rejectRecovery(
    request: identityGrpc.RejectRecoveryRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RejectRecoveryResponse> {
    const actor = requireAccountContext(context);
    const { recoveryId } = parseRpcRequest(recoveryIdField, request);
    const { decisionNote } = parseRpcRequest(zRejectRecoveryInput, {
      decisionNote: request.decisionNote,
    });
    const now = new Date();

    const outcome = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, recoveryId);
      if (!allows('reject', current.status)) {
        throw rpcError('INVALID_STATE', { status: current.status });
      }
      const row = await tx.accountRecovery.update({
        where: { id: recoveryId },
        data: {
          status: AccountRecoveryStatus.REJECTED,
          decisionNote,
          // A closed case keeps no usable token (rdm-spec I-14).
          cancelTokenHash: null,
        },
        select: RECOVERY_SELECT,
      });
      const audited = await this.audit(
        tx,
        actor,
        now,
        AuditAction.ACCOUNT_RECOVERY_REJECTED,
        recoveryId,
        { after: { hasDecisionNote: true } },
      );
      const mail = await this.email.prepare(tx, {
        template: EmailTemplate.ACCOUNT_RECOVERY_OUTCOME,
        eventId: audited.eventId,
        recipient: { userId: row.userId },
        data: { recoveryId, stage: 'REJECTED' },
        links: { action: { path: 'signIn' } },
      });
      return { row, mail };
    });
    this.dispatcher.run([outcome.mail]);
    return { recovery: toRecovery(outcome.row) };
  }

  /** The case, locked for the length of a decision. */
  private async lock(tx: Prisma.TransactionClient, recoveryId: string): Promise<RecoveryRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM account_recoveries WHERE id = ${recoveryId}::uuid FOR UPDATE`;
    if (locked[0] === undefined) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: AuditResourceType.ACCOUNT_RECOVERY });
    }
    return tx.accountRecovery.findUniqueOrThrow({
      where: { id: recoveryId },
      select: RECOVERY_SELECT,
    });
  }

  /** Two checks, one of them the phone callback (rdm-spec I-14); the database says it too. */
  private requireEvidence(codes: readonly RecoveryEvidenceCode[]): void {
    if (codes.length < 2 || !codes.includes(RecoveryEvidenceCode.PHONE_CALLBACK)) {
      throw rpcError('RECOVERY_EVIDENCE_INSUFFICIENT');
    }
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: AccountContext,
    now: Date,
    action: AuditAction,
    recoveryId: string,
    metadata: { after?: Record<string, unknown>; before?: Record<string, unknown> },
  ): Promise<{ eventId: string }> {
    return this.outbox.add(
      tx,
      AUDIT_RECORD,
      auditRecord({
        now,
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        resource: { type: AuditResourceType.ACCOUNT_RECOVERY, id: recoveryId },
        metadata,
        origin: actor.origin,
      }),
    );
  }
}
