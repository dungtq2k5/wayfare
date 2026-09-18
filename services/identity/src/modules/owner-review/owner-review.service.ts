import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  EmailTemplate,
  IDENTITY_OWNER_VERIFIED,
  NotificationType,
  OwnerRegistrationStatus,
  SystemRole,
  zApproveRegistrationInput,
  zOwnerRegistrationQueueQuery,
  zRejectRegistrationInput,
  zUuidV7,
} from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { ownerRegistrationStatusProto } from '@wayfare/contracts/grpc';
import {
  decryptPii,
  escapeLike,
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  requireProtoEnum,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client';
import type { Env } from '../../config/env.schema';
import { AccessService } from '../access/access.service';
import { auditRecord } from '../audit/domain/audit-record';
import type { AuditFacts } from '../audit/domain/audit-record';
import { EmailDispatcher } from '../email/email.module';
import { EmailService } from '../email/email.service';
import type { PendingEmail } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { DeliveryResult } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import {
  OWNER_REGISTRATION_ADMIN_SELECT,
  PRIOR_REGISTRATION_SELECT,
  toOwnerRegistrationAdmin,
  toOwnerRegistrationAdminItem,
} from './owner-review.mapper';
import type { OwnerRegistrationAdminRow } from './owner-review.mapper';

const PENDING: string = OwnerRegistrationStatus.PENDING;
const VENUE_OWNER: string = SystemRole.VENUE_OWNER;

const registrationIdField = z.object({ registrationId: zUuidV7 });

/** Proto3 `optional` strings may arrive as `null`; the schema reads absent as `undefined`. */
function present<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

/** A decision: which one, and what the applicant and staff are told. */
interface Decision {
  readonly status: OwnerRegistrationStatus.APPROVED | OwnerRegistrationStatus.REJECTED;
  readonly decisionNote?: string;
  readonly internalNote?: string;
}

/** The applicant's row, locked while a decision is made. */
interface ApplicantLockRow {
  readonly owner_verified_at: Date | null;
  readonly deleted_at: Date | null;
  readonly erased_at: Date | null;
}

/** What a decision leaves for after the commit. */
interface DecisionOutcome {
  readonly row: OwnerRegistrationAdminRow;
  readonly delivered: DeliveryResult;
  readonly mail: PendingEmail | null;
}

/**
 * The review queue (api-endpoints-plan §1.5, rdm-spec I-8). The gateway checked the route's
 * permission; this service checks what only the database knows — the application is still
 * `PENDING`, the applicant is live, and the reviewer is not the applicant.
 */
@Injectable()
export class OwnerReviewService {
  private readonly logger = new Logger(OwnerReviewService.name);
  private readonly piiKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly access: AccessService,
    private readonly sessions: SessionsService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly dispatcher: EmailDispatcher,
    config: ConfigService<Env, true>,
  ) {
    this.piiKey = config.get('PII_ENCRYPTION_KEY', { infer: true });
  }

  /**
   * The queue, a page at a time. Search is literal (`ILIKE` with the wildcards escaped) over the
   * business and contact names. `PENDING` is oldest first; the other statuses newest first.
   */
  async listRegistrations(
    request: identityGrpc.ListRegistrationsRequest,
    context: RequestContext,
  ): Promise<identityGrpc.ListRegistrationsResponse> {
    requireAccountContext(context);
    const status = requireProtoEnum(ownerRegistrationStatusProto, request.status, '/status');
    const query = parseRpcRequest(zOwnerRegistrationQueueQuery, {
      page: request.page?.page,
      pageSize: request.page?.pageSize,
      q: present(request.page?.q),
      status,
    });
    const conditions: Prisma.Sql[] = [Prisma.sql`r.status = ${query.status}`];
    if (query.q !== undefined) {
      const pattern = `%${escapeLike(query.q)}%`;
      conditions.push(
        Prisma.sql`(r.business_name ILIKE ${pattern} ESCAPE '\\' OR r.contact_name ILIKE ${pattern} ESCAPE '\\')`,
      );
    }
    const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    // A fixed choice, never the request's text.
    const orderBy = Prisma.raw(
      query.status === OwnerRegistrationStatus.PENDING
        ? 'r.submitted_at ASC, r.id ASC'
        : 'r.submitted_at DESC, r.id DESC',
    );
    const [counted, ids] = await Promise.all([
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM owner_registrations r ${where}`,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT r.id FROM owner_registrations r ${where}
        ORDER BY ${orderBy}
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    ]);
    const rows = await this.prisma.ownerRegistration.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      select: OWNER_REGISTRATION_ADMIN_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      registrations: ids.flatMap(({ id }) => {
        const row = byId.get(id);
        return row === undefined ? [] : [toOwnerRegistrationAdminItem(row)];
      }),
      page: { page: query.page, pageSize: query.pageSize, total: counted[0]?.total ?? 0 },
    };
  }

  /** One application with its applicant's account and their other applications. */
  async getRegistration(
    request: identityGrpc.GetRegistrationRequest,
    context: RequestContext,
  ): Promise<identityGrpc.GetRegistrationResponse> {
    requireAccountContext(context);
    const { registrationId } = parseRpcRequest(registrationIdField, request);
    const registration = await this.prisma.$transaction((tx) =>
      this.detail(tx, registrationId, new Date()),
    );
    return { registration };
  }

  /**
   * Decrypts the national ID once, with an audit row that never holds the number. A redacted row
   * is `NATIONAL_ID_REDACTED`.
   */
  async revealNationalId(
    request: identityGrpc.RevealNationalIdRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RevealNationalIdResponse> {
    const actor = requireAccountContext(context);
    const { registrationId } = parseRpcRequest(registrationIdField, request);
    const now = new Date();
    const stored = await this.prisma.$transaction(async (tx) => {
      const row = await tx.ownerRegistration.findUnique({
        where: { id: registrationId },
        select: { nationalIdCiphertext: true },
      });
      if (row === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'OWNER_REGISTRATION' });
      if (row.nationalIdCiphertext === null) throw rpcError('NATIONAL_ID_REDACTED');
      await this.audit(tx, actor, AuditAction.OWNER_NATIONAL_ID_REVEALED, registrationId, now);
      return row.nationalIdCiphertext;
    });
    try {
      return { nationalId: decryptPii(this.piiKey, stored) };
    } catch (error) {
      // The error names the failure only; the value and the ciphertext are never logged.
      this.logger.error(
        { registrationId, kind: error instanceof Error ? error.name : 'unknown' },
        'national ID could not be decrypted',
      );
      throw rpcError('INTERNAL');
    }
  }

  /**
   * Approves (rdm-spec I-8), in one transaction: the decision, owner verification and the
   * `VENUE_OWNER` role, the token cutoff, `identity.owner.verified`, the audit row, the
   * notification and the email. The frames and the send follow the commit.
   */
  async approveRegistration(
    request: identityGrpc.ApproveRegistrationRequest,
    context: RequestContext,
  ): Promise<identityGrpc.ApproveRegistrationResponse> {
    const actor = requireAccountContext(context);
    const { registrationId } = parseRpcRequest(registrationIdField, request);
    const notes = parseRpcRequest(zApproveRegistrationInput, {
      decisionNote: present(request.decisionNote),
      internalNote: present(request.internalNote),
    });
    const registration = await this.decide(actor, registrationId, {
      status: OwnerRegistrationStatus.APPROVED,
      ...notes,
    });
    return { registration };
  }

  /** Rejects with the note the applicant is always shown. The applicant may apply again. */
  async rejectRegistration(
    request: identityGrpc.RejectRegistrationRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RejectRegistrationResponse> {
    const actor = requireAccountContext(context);
    const { registrationId } = parseRpcRequest(registrationIdField, request);
    const notes = parseRpcRequest(zRejectRegistrationInput, {
      decisionNote: request.decisionNote,
      internalNote: present(request.internalNote),
    });
    const registration = await this.decide(actor, registrationId, {
      status: OwnerRegistrationStatus.REJECTED,
      ...notes,
    });
    return { registration };
  }

  private async decide(
    actor: AccountContext,
    registrationId: string,
    decision: Decision,
  ): Promise<identityGrpc.OwnerRegistrationAdmin> {
    const now = new Date();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const current = await tx.ownerRegistration.findUnique({
        where: { id: registrationId },
        select: { userId: true },
      });
      if (current === null)
        throw rpcError('RESOURCE_NOT_FOUND', { resource: 'OWNER_REGISTRATION' });
      const applicantId = current.userId;
      if (applicantId === actor.userId) {
        throw rpcError('PERMISSION_DENIED', { required: ['owner_registration.review'] });
      }
      // The applicant's row first, as applying does: a deactivation cannot slip in between.
      const [applicant] = await tx.$queryRaw<ApplicantLockRow[]>`
        SELECT owner_verified_at, deleted_at, erased_at
        FROM users WHERE id = ${applicantId}::uuid
        FOR UPDATE`;
      if (applicant === undefined) {
        throw rpcError('RESOURCE_NOT_FOUND', { resource: 'OWNER_REGISTRATION' });
      }
      const moved = await tx.ownerRegistration.updateMany({
        where: { id: registrationId, status: PENDING },
        data: {
          status: decision.status,
          reviewedAt: now,
          reviewedById: actor.userId,
          decisionNote: decision.decisionNote ?? null,
          internalNote: decision.internalNote ?? null,
        },
      });
      if (moved.count === 0) {
        const latest = await tx.ownerRegistration.findUniqueOrThrow({
          where: { id: registrationId },
          select: { status: true },
        });
        throw rpcError('INVALID_STATE', { status: latest.status });
      }
      if (applicant.erased_at !== null) throw rpcError('INVALID_STATE', { status: 'ERASED' });
      if (applicant.deleted_at !== null) throw rpcError('INVALID_STATE', { status: 'DEACTIVATED' });

      const approved = decision.status === OwnerRegistrationStatus.APPROVED;
      if (approved) await this.makeOwner(tx, applicantId, applicant, now);

      const audited = await this.audit(
        tx,
        actor,
        approved
          ? AuditAction.OWNER_REGISTRATION_APPROVED
          : AuditAction.OWNER_REGISTRATION_REJECTED,
        registrationId,
        now,
        {
          after: {
            status: decision.status,
            hasDecisionNote: decision.decisionNote !== undefined,
            hasInternalNote: decision.internalNote !== undefined,
          },
        },
      );
      const note =
        decision.decisionNote === undefined ? {} : { decisionNote: decision.decisionNote };
      // The decision's audit event names both: one notification and one email per decision.
      const delivered = await this.notifications.deliver(tx, {
        recipientUserId: applicantId,
        eventId: audited.eventId,
        notification: {
          type: approved
            ? NotificationType.OWNER_REGISTRATION_APPROVED
            : NotificationType.OWNER_REGISTRATION_REJECTED,
          data: { registrationId, ...note },
        },
      });
      const mail = await this.email.prepare(tx, {
        template: EmailTemplate.OWNER_REGISTRATION_OUTCOME,
        eventId: audited.eventId,
        recipient: { userId: applicantId },
        data: { registrationId, decision: decision.status, ...note },
        links: { action: { path: 'ownerRegistration' } },
        linkApp: 'console',
      });
      const row = await tx.ownerRegistration.findUniqueOrThrow({
        where: { id: registrationId },
        select: OWNER_REGISTRATION_ADMIN_SELECT,
      });
      return { row, delivered, mail } satisfies DecisionOutcome;
    });
    if (outcome.delivered.inserted) await this.notifications.announce(outcome.delivered.row);
    this.dispatcher.run([outcome.mail]);
    return this.prisma.$transaction((tx) => this.detail(tx, outcome.row.id, now));
  }

  /**
   * Verification: `owner_verified_at` once, `VENUE_OWNER` if missing, the token cutoff so the next
   * request refreshes into the new claims, and `identity.owner.verified` for billing.
   */
  private async makeOwner(
    tx: Prisma.TransactionClient,
    userId: string,
    applicant: ApplicantLockRow,
    now: Date,
  ): Promise<void> {
    if (applicant.owner_verified_at === null) {
      await tx.user.update({
        where: { id: userId },
        data: { ownerVerifiedAt: now },
        select: { id: true },
      });
    }
    const held = await tx.userRole.findFirst({
      where: { userId, role: { code: VENUE_OWNER } },
      select: { userId: true },
    });
    if (held === null) await this.access.assignRole(tx, userId, VENUE_OWNER);
    await this.sessions.bumpCutoff(tx, [userId], now);
    if (applicant.owner_verified_at === null) {
      await this.outbox.add(tx, IDENTITY_OWNER_VERIFIED, {
        occurredAt: now.toISOString(),
        userId,
      });
    }
  }

  private async detail(
    tx: Prisma.TransactionClient,
    registrationId: string,
    now: Date,
  ): Promise<identityGrpc.OwnerRegistrationAdmin> {
    const row = await tx.ownerRegistration.findUnique({
      where: { id: registrationId },
      select: OWNER_REGISTRATION_ADMIN_SELECT,
    });
    if (row === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'OWNER_REGISTRATION' });
    const prior = await tx.ownerRegistration.findMany({
      where: { userId: row.userId, id: { not: row.id } },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      select: PRIOR_REGISTRATION_SELECT,
    });
    return toOwnerRegistrationAdmin(row, prior, now);
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: AccountContext,
    action: AuditAction,
    registrationId: string,
    now: Date,
    metadata?: AuditFacts['metadata'],
  ): Promise<{ eventId: string }> {
    return this.outbox.add(
      tx,
      AUDIT_RECORD,
      auditRecord({
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        resource: { type: AuditResourceType.OWNER_REGISTRATION, id: registrationId },
        ...(metadata === undefined ? {} : { metadata }),
        origin: actor.origin,
        now,
      }),
    );
  }
}
