import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  ActionTokenPurpose,
  compareStrings,
  EmailTemplate,
  IDENTITY_USER_DEACTIVATED,
  IDENTITY_USER_LOCKED,
  MAX_ADMIN_REASON_LENGTH,
  MAX_FULL_NAME_LENGTH,
  MAX_LOCK_DURATION_MS,
  MAX_LOCK_REASON_LENGTH,
  MAX_ROLES_PER_USER,
  normalizeText,
  SessionClient,
  SessionRevokedReason,
  SystemRole,
  zEmail,
  zCursorQuery,
  zPageQuery,
  zUuidV7,
} from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  decodeCursor,
  encodeCursor,
  escapeLike,
  isUniqueConstraintViolation,
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
  zProtoTimestamp,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client';
import { AccessService } from '../access/access.service';
import { AccountLinksService } from '../account-links/account-links.service';
import { permissionsOf, roleCodesOf } from '../access/domain/permissions-of';
import type { RoleGrants } from '../access/domain/permissions-of';
import { auditRecord } from '../audit/domain/audit-record';
import type { AuditFacts } from '../audit/domain/audit-record';
import { BillingPortService } from '../billing-port/billing-port.service';
import { EMAIL_DELIVERY_VIEW_SELECT, toEmailDeliveryView } from '../email/email-delivery.mapper';
import { EmailDispatcher } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import {
  ADMIN_USER_SELECT,
  toAdminUser,
  toAdminUserDetail,
  toAdminUserListItem,
  toErasedUser,
} from './admin-user.mapper';
import type { AdminUserRow } from './admin-user.mapper';
import { addedCodesActorLacks, targetCodesActorLacks } from './domain/escalation';

// Widened: role codes are read from the database as plain strings.
const SUPER_ADMIN_CODE: string = SystemRole.SUPER_ADMIN;

const USER_SORT_COLUMNS = {
  createdAt: 'created_at',
  email: 'email',
  lastLoginAt: 'last_login_at',
} as const;

const zFullName = z
  .string()
  .transform(normalizeText)
  .pipe(
    z
      .string()
      .min(1)
      .max(MAX_FULL_NAME_LENGTH)
      .regex(/^[^\n]*$/),
  );

const zRoleIds = z
  .array(zUuidV7)
  .max(MAX_ROLES_PER_USER)
  .transform((ids) => [...new Set(ids)]);

const zReason = (max: number) =>
  z.string().transform(normalizeText).pipe(z.string().min(1).max(max));

const userIdField = z.object({ userId: zUuidV7 });

const listFields = z.object({
  page: zPageQuery({
    sort: ['createdAt', 'email', 'lastLoginAt'],
    defaultSort: '-createdAt',
    search: true,
  }),
  roleId: zUuidV7.optional(),
  isLocked: z.boolean().optional(),
  ownerVerified: z.boolean().optional(),
  includeDeleted: z.boolean(),
});

const createFields = z.object({
  email: zEmail,
  fullName: zFullName,
  roleIds: zRoleIds.pipe(z.array(z.string()).min(1)),
});

const updateFields = z.object({ userId: zUuidV7, fullName: zFullName.optional() });

const deliveriesFields = z.object({ userId: zUuidV7, page: zCursorQuery });

const checkFields = z.object({ userId: zUuidV7, email: zEmail });

const setRolesFields = z.object({ userId: zUuidV7, roleIds: zRoleIds });

const lockFields = z.object({
  userId: zUuidV7,
  reason: zReason(MAX_LOCK_REASON_LENGTH),
  // Absent arrives as null from the proto loader.
  lockedUntil: zProtoTimestamp.nullish(),
});

const deactivateFields = z.object({
  userId: zUuidV7,
  reason: zReason(MAX_ADMIN_REASON_LENGTH),
  refundUnredeemedVouchers: z.boolean(),
});

/** A role as a change reads it: its code and live grants. */
interface RoleGrantsRow {
  readonly id: string;
  readonly code: string;
  readonly permissions: readonly { readonly permission: { code: string; isRetired: boolean } }[];
}

const ROLE_GRANTS_SELECT = {
  id: true,
  code: true,
  permissions: { select: { permission: { select: { code: true, isRetired: true } } } },
} as const satisfies Prisma.RoleSelect;

/**
 * Staff administration of accounts (api-endpoints-plan §1.6). The gateway checked the route's
 * permission; this service checks what only the database knows: no escalation, no acting above
 * your own level, no self-lock, and never fewer than one active `SUPER_ADMIN`.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly access: AccessService,
    private readonly sessions: SessionsService,
    private readonly billing: BillingPortService,
    private readonly links: AccountLinksService,
    private readonly email: EmailService,
    private readonly dispatcher: EmailDispatcher,
  ) {}

  /**
   * The console's user table. Search is literal (`ILIKE` with the wildcards escaped);
   * `lastLoginAt` sorts never-signed-in accounts last in both directions.
   */
  async listUsers(
    request: identityGrpc.ListUsersRequest,
    context: RequestContext,
  ): Promise<identityGrpc.ListUsersResponse> {
    requireAccountContext(context);
    const fields = parseRpcRequest(listFields, request);
    const { page, pageSize, sort, q } = fields.page;
    const now = new Date();

    const conditions: Prisma.Sql[] = [];
    if (!fields.includeDeleted) conditions.push(Prisma.sql`u.deleted_at IS NULL`);
    if (q !== undefined) {
      const pattern = `%${escapeLike(q)}%`;
      // An erased row keeps nothing to search.
      conditions.push(
        Prisma.sql`u.erased_at IS NULL AND (u.email ILIKE ${pattern} ESCAPE '\\' OR u.full_name ILIKE ${pattern} ESCAPE '\\')`,
      );
    }
    if (fields.roleId !== undefined) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = ${fields.roleId}::uuid)`,
      );
    }
    if (fields.isLocked !== undefined) {
      const lockedNow = Prisma.sql`(u.is_locked AND (u.locked_until IS NULL OR u.locked_until > ${now}))`;
      conditions.push(fields.isLocked ? lockedNow : Prisma.sql`NOT ${lockedNow}`);
    }
    if (fields.ownerVerified !== undefined) {
      conditions.push(
        fields.ownerVerified
          ? Prisma.sql`u.owner_verified_at IS NOT NULL`
          : Prisma.sql`u.owner_verified_at IS NULL`,
      );
    }
    const where =
      conditions.length === 0
        ? Prisma.empty
        : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const descending = sort.startsWith('-');
    const field = (descending ? sort.slice(1) : sort) as keyof typeof USER_SORT_COLUMNS;
    const direction = descending ? 'DESC' : 'ASC';
    // Both parts come from fixed tables above, never from the request.
    const orderBy = Prisma.raw(
      `u.${USER_SORT_COLUMNS[field]} ${direction} NULLS LAST, u.id ${direction}`,
    );

    const [counted, ids] = await Promise.all([
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM users u ${where}`,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT u.id FROM users u ${where}
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    ]);
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      select: ADMIN_USER_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      users: ids.flatMap(({ id }) => {
        const row = byId.get(id);
        return row === undefined ? [] : [toAdminUserListItem(row, now)];
      }),
      page: { page, pageSize, total: counted[0]?.total ?? 0 },
    };
  }

  /** One account with its devices and live sessions; an erased one is its placeholder. */
  async getUser(
    request: identityGrpc.GetUserRequest,
    context: RequestContext,
  ): Promise<identityGrpc.GetUserResponse> {
    requireAccountContext(context);
    const { userId } = parseRpcRequest(userIdField, request);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const row = await this.target(tx, userId);
      if (row.erasedAt !== null)
        return { erased: toErasedUser({ ...row, erasedAt: row.erasedAt }) };
      const [devicesCount, sessions] = await Promise.all([
        tx.device.count({ where: { userId } }),
        tx.session.findMany({
          where: { userId, rotatedAt: null, revokedAt: null, expiresAt: { gt: now } },
          select: { client: true },
          distinct: ['familyId'],
        }),
      ]);
      const byClient = (client: SessionClient) =>
        sessions.filter((session) => session.client === (client as string)).length;
      return {
        user: toAdminUserDetail(
          row,
          {
            devicesCount,
            sessions: {
              live: sessions.length,
              console: byClient(SessionClient.CONSOLE),
              web: byClient(SessionClient.WEB),
              mobile: byClient(SessionClient.MOBILE),
            },
          },
          now,
        ),
      };
    });
  }

  /**
   * Creates a staff account with no password and its roles. `SUPER_ADMIN` is never assignable
   * here, and the new account holds nothing its creator does not.
   */
  async createStaffUser(
    request: identityGrpc.CreateStaffUserRequest,
    context: RequestContext,
  ): Promise<identityGrpc.CreateStaffUserResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(createFields, request);
    const now = new Date();
    const taken = await this.prisma.user.findUnique({
      where: { email: fields.email },
      select: { id: true },
    });
    // An address a live revert reserves is taken, like one in use (rdm-spec I-9).
    if (taken !== null || (await this.links.liveRevertFor(this.prisma, { email: fields.email }))) {
      throw rpcError('EMAIL_TAKEN');
    }
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const roles = await this.requestedRoles(tx, fields.roleIds);
        const actorCodes = await this.codesOf(tx, actor.userId);
        requireNone(
          addedCodesActorLacks({ actorCodes, before: [], after: permissionsOf(grantsOf(roles)) }),
        );
        const user = await tx.user.create({
          data: { email: fields.email, fullName: fields.fullName },
          select: { id: true },
        });
        await tx.userRole.createMany({
          data: roles.map((role) => ({ userId: user.id, roleId: role.id })),
        });
        await this.audit(tx, actor, AuditAction.STAFF_USER_CREATED, user.id, now, {
          after: { roleCodes: roleCodesOf(grantsOf(roles)) },
        });
        const setup = await this.links.mint(tx, {
          userId: user.id,
          purpose: ActionTokenPurpose.ACCOUNT_SETUP,
          targetEmail: fields.email,
          origin: actor.origin,
          now,
        });
        const actorRoles = await tx.userRole.findMany({
          where: { userId: actor.userId },
          select: { role: { select: { name: true } } },
        });
        const mail = await this.email.prepare(tx, {
          template: EmailTemplate.ACCOUNT_SETUP,
          eventId: setup.id,
          recipient: { userId: user.id },
          data: {
            inviterRoleNames: actorRoles.map(({ role }) => role.name).toSorted(compareStrings),
          },
          links: { action: { path: 'setupAccount', token: setup.token } },
        });
        return { row: await this.target(tx, user.id), mail };
      });
      this.dispatcher.run([created.mail]);
      return { user: toAdminUser(created.row, now) };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw rpcError('EMAIL_TAKEN');
      throw error;
    }
  }

  /** Renames an account. The audit row names the field, never the value. */
  async updateUser(
    request: identityGrpc.UpdateUserRequest,
    context: RequestContext,
  ): Promise<identityGrpc.UpdateUserResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(updateFields, request);
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const target = await this.target(tx, fields.userId);
      if (target.erasedAt !== null) throw rpcError('INVALID_STATE', { status: 'ERASED' });
      await this.requireOutrank(tx, actor, target.id);
      if (fields.fullName === undefined || fields.fullName === target.fullName) return target;
      await tx.user.update({
        where: { id: target.id },
        data: { fullName: fields.fullName },
        select: { id: true },
      });
      await this.audit(tx, actor, AuditAction.USER_UPDATED, target.id, now, {
        after: { changedFields: ['fullName'] },
      });
      return this.target(tx, target.id);
    });
    return { user: toAdminUser(row, now) };
  }

  /**
   * Replaces an account's roles and bumps its token cutoff without revoking a session — the next
   * refresh carries the new permissions (rdm-spec I-1).
   */
  async setUserRoles(
    request: identityGrpc.SetUserRolesRequest,
    context: RequestContext,
  ): Promise<identityGrpc.SetUserRolesResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(setRolesFields, request);
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      await this.access.lockSuperAdmins(tx);
      const target = await this.target(tx, fields.userId);
      requireLive(target);
      const roles = await this.requestedRoles(tx, fields.roleIds, {
        alreadyHeld: target.roles.map(({ role }) => role.id),
      });
      const current = await this.access.accessOf(tx, target.id);
      const actorCodes = await this.codesOf(tx, actor.userId);
      requireNone(targetCodesActorLacks({ actorCodes, targetCodes: current.permissions }));
      requireNone(
        addedCodesActorLacks({
          actorCodes,
          before: current.permissions,
          after: permissionsOf(grantsOf(roles)),
        }),
      );
      const after = roleCodesOf(grantsOf(roles));
      if (
        current.roles.includes(SystemRole.SUPER_ADMIN) &&
        !after.includes(SystemRole.SUPER_ADMIN)
      ) {
        await this.access.requireSuperAdminRemains(
          tx,
          { kind: 'REMOVE_ROLE', userId: target.id },
          now,
        );
      }
      if (sameCodes(current.roles, after)) return target;

      await tx.userRole.deleteMany({ where: { userId: target.id } });
      await tx.userRole.createMany({
        data: roles.map((role) => ({ userId: target.id, roleId: role.id })),
      });
      await this.sessions.bumpCutoff(tx, [target.id], now);
      await this.audit(tx, actor, AuditAction.USER_ROLES_UPDATED, target.id, now, {
        before: { roleCodes: current.roles },
        after: { roleCodes: after },
      });
      return this.target(tx, target.id);
    });
    return { user: toAdminUser(row, now) };
  }

  /**
   * Locks an account for investigation: its sessions end and its tokens die within seconds.
   * Locking again updates the reason and expiry.
   */
  async lockUser(
    request: identityGrpc.LockUserRequest,
    context: RequestContext,
  ): Promise<identityGrpc.LockUserResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(lockFields, request);
    const now = new Date();
    const lockedUntil = fields.lockedUntil ?? null;
    if (
      lockedUntil !== null &&
      (lockedUntil.getTime() <= now.getTime() ||
        lockedUntil.getTime() > now.getTime() + MAX_LOCK_DURATION_MS)
    ) {
      throw rpcError('VALIDATION_FAILED', {
        issues: [{ path: '/lockedUntil', code: 'custom' }],
      });
    }
    if (fields.userId === actor.userId) throw rpcError('SELF_ACTION_FORBIDDEN');
    await this.prisma.$transaction(async (tx) => {
      await this.access.lockSuperAdmins(tx);
      const target = await this.target(tx, fields.userId);
      requireLive(target);
      await this.requireOutrank(tx, actor, target.id);
      await this.access.requireSuperAdminRemains(tx, { kind: 'LOCK', userId: target.id }, now);
      await tx.user.update({
        where: { id: target.id },
        data: { isLocked: true, lockedUntil, lockReason: fields.reason },
        select: { id: true },
      });
      await this.sessions.revokeAllForUser(tx, target.id, SessionRevokedReason.LOCKED, {
        bumpCutoff: true,
        now,
      });
      await this.outbox.add(tx, IDENTITY_USER_LOCKED, {
        occurredAt: now.toISOString(),
        userId: target.id,
      });
      await this.audit(tx, actor, AuditAction.USER_LOCKED, target.id, now, {
        after: { lockedUntil: lockedUntil?.toISOString() ?? null },
        reason: fields.reason,
      });
    });
    return {};
  }

  /** Clears a lock and its expiry. Idempotent: an unlocked account writes nothing. */
  async unlockUser(
    request: identityGrpc.UnlockUserRequest,
    context: RequestContext,
  ): Promise<identityGrpc.UnlockUserResponse> {
    const actor = requireAccountContext(context);
    const { userId } = parseRpcRequest(userIdField, request);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const target = await this.target(tx, userId);
      await this.requireOutrank(tx, actor, target.id);
      if (!target.isLocked && target.lockedUntil === null && target.lockReason === null) return;
      await tx.user.update({
        where: { id: target.id },
        data: { isLocked: false, lockedUntil: null, lockReason: null },
        select: { id: true },
      });
      await this.audit(tx, actor, AuditAction.USER_UNLOCKED, target.id, now, {
        before: { lockedUntil: target.lockedUntil?.toISOString() ?? null },
      });
    });
    return {};
  }

  /**
   * Deactivates an account (restorable). An owner is checked with billing first, outside the
   * transaction; if billing cannot answer, nothing is written (api-endpoints-plan §12.2).
   */
  async deactivateUser(
    request: identityGrpc.DeactivateUserRequest,
    context: RequestContext,
  ): Promise<identityGrpc.DeactivateUserResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(deactivateFields, request);
    if (fields.userId === actor.userId) throw rpcError('SELF_ACTION_FORBIDDEN');
    const before = await this.target(this.prisma, fields.userId);
    await this.requireOutrank(this.prisma, actor, before.id);
    if (before.deletedAt !== null) return {};
    const isOwner = before.ownerVerifiedAt !== null;
    if (isOwner) {
      const obligations = await this.billing.getLiveObligations(before.id);
      const live = obligations.issuedVoucherCount > 0 || obligations.openCheckoutCount > 0;
      if (live && !fields.refundUnredeemedVouchers) {
        throw rpcError('OWNER_HAS_LIVE_VOUCHERS', {
          issuedVoucherCount: obligations.issuedVoucherCount,
          openCheckoutCount: obligations.openCheckoutCount,
        });
      }
    }
    const refund = isOwner && fields.refundUnredeemedVouchers;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.access.lockSuperAdmins(tx);
      const target = await this.target(tx, fields.userId);
      await this.requireOutrank(tx, actor, target.id);
      if (target.deletedAt !== null) return; // a concurrent deactivation won
      if ((target.ownerVerifiedAt !== null) !== isOwner) {
        throw rpcError('INVALID_STATE', { status: 'OWNER_STATUS_CHANGED' });
      }
      await this.access.requireSuperAdminRemains(
        tx,
        { kind: 'DEACTIVATE', userId: target.id },
        now,
      );
      await tx.user.update({
        where: { id: target.id },
        data: { deletedAt: now, deletedById: actor.userId },
        select: { id: true },
      });
      const revokedFamilies = await this.sessions.revokeAllForUser(
        tx,
        target.id,
        SessionRevokedReason.ADMIN,
        { bumpCutoff: true, now },
      );
      await this.outbox.add(tx, IDENTITY_USER_DEACTIVATED, {
        occurredAt: now.toISOString(),
        userId: target.id,
        refundUnredeemedVouchers: refund,
      });
      await this.audit(tx, actor, AuditAction.USER_DEACTIVATED, target.id, now, {
        after: { wasOwner: isOwner, refundUnredeemedVouchers: refund, revokedFamilies },
        reason: fields.reason,
      });
    });
    return {};
  }

  /**
   * Undoes a deactivation. Nothing elsewhere is revived (ADR 0053), and no token work is needed:
   * the deactivation's cutoff already ended every older token.
   */
  async restoreUser(
    request: identityGrpc.RestoreUserRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RestoreUserResponse> {
    const actor = requireAccountContext(context);
    const { userId } = parseRpcRequest(userIdField, request);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const target = await this.target(tx, userId);
      await this.requireOutrank(tx, actor, target.id);
      if (target.erasedAt !== null) throw rpcError('INVALID_STATE', { status: 'ERASED' });
      if (target.deletedAt === null) return;
      await tx.user.update({
        where: { id: target.id },
        data: { deletedAt: null, deletedById: null },
        select: { id: true },
      });
      await this.audit(tx, actor, AuditAction.USER_RESTORED, target.id, now, {});
    });
    return {};
  }

  /** Signs an account out everywhere. Allowed on yourself. */
  async revokeUserSessions(
    request: identityGrpc.RevokeUserSessionsRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RevokeUserSessionsResponse> {
    const actor = requireAccountContext(context);
    const { userId } = parseRpcRequest(userIdField, request);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const target = await this.target(tx, userId);
      if (target.id !== actor.userId) await this.requireOutrank(tx, actor, target.id);
      const revokedFamilies = await this.sessions.revokeAllForUser(
        tx,
        target.id,
        SessionRevokedReason.ADMIN,
        { bumpCutoff: true, now },
      );
      await this.audit(tx, actor, AuditAction.USER_SESSIONS_REVOKED, target.id, now, {
        after: { revokedFamilies },
      });
    });
    return {};
  }

  /** What was sent to an account, newest first — metadata only (rdm-spec I-13). */
  async listEmailDeliveries(
    request: identityGrpc.ListEmailDeliveriesRequest,
    context: RequestContext,
  ): Promise<identityGrpc.ListEmailDeliveriesResponse> {
    requireAccountContext(context);
    const fields = parseRpcRequest(deliveriesFields, request);
    const after = fields.page.cursor === undefined ? undefined : decodeCursor(fields.page.cursor);
    if (after === null) {
      throw rpcError('VALIDATION_FAILED', {
        issues: [{ path: '/page/cursor', code: 'invalid_format' }],
      });
    }
    await this.target(this.prisma, fields.userId);
    const rows = await this.prisma.emailDelivery.findMany({
      where: {
        recipientUserId: fields.userId,
        ...(after === undefined ? {} : { id: { lt: after.id } }),
      },
      orderBy: { id: 'desc' },
      take: fields.page.limit + 1,
      select: EMAIL_DELIVERY_VIEW_SELECT,
    });
    const page = rows.slice(0, fields.page.limit);
    const last = page.at(-1);
    return {
      deliveries: page.map(toEmailDeliveryView),
      page:
        rows.length > fields.page.limit && last !== undefined
          ? { nextCursor: encodeCursor({ id: last.id }) }
          : {},
    };
  }

  /**
   * Whether a claimed address received any of an account's mail, by keyed hash — without revealing
   * the stored one. Every check is audited: it is also a guess (api-endpoints-plan §1.6).
   */
  async checkEmailDelivery(
    request: identityGrpc.CheckEmailDeliveryRequest,
    context: RequestContext,
  ): Promise<identityGrpc.CheckEmailDeliveryResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(checkFields, request);
    const now = new Date();
    const matches = await this.prisma.$transaction(async (tx) => {
      await this.target(tx, fields.userId);
      const found = await tx.emailDelivery.findFirst({
        where: {
          recipientUserId: fields.userId,
          toEmailHash: this.email.addressHash(fields.email),
        },
        select: { id: true },
      });
      await this.audit(tx, actor, AuditAction.EMAIL_ADDRESS_CHECKED, fields.userId, now, {
        after: { matches: found !== null },
      });
      return found !== null;
    });
    return { matches };
  }

  /** The addressed account; missing → `RESOURCE_NOT_FOUND`. */
  private async target(db: Prisma.TransactionClient, userId: string): Promise<AdminUserRow> {
    const row = await db.user.findUnique({ where: { id: userId }, select: ADMIN_USER_SELECT });
    if (row === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'USER' });
    return row;
  }

  /** A user's live permission codes, read from the database — never from a token. */
  private async codesOf(db: Prisma.TransactionClient, userId: string): Promise<string[]> {
    return (await this.access.accessOf(db, userId)).permissions;
  }

  /** No acting above your own level: the actor holds every code the target holds. */
  private async requireOutrank(
    db: Prisma.TransactionClient,
    actor: AccountContext,
    targetId: string,
  ): Promise<void> {
    const [actorCodes, targetCodes] = await Promise.all([
      this.codesOf(db, actor.userId),
      this.codesOf(db, targetId),
    ]);
    requireNone(targetCodesActorLacks({ actorCodes, targetCodes }));
  }

  /**
   * The roles a request names, with their grants. An unknown id is `RESOURCE_NOT_FOUND`;
   * `SUPER_ADMIN` is never assignable here, unless the account already holds it.
   */
  private async requestedRoles(
    tx: Prisma.TransactionClient,
    roleIds: readonly string[],
    options: { readonly alreadyHeld?: readonly string[] } = {},
  ): Promise<RoleGrantsRow[]> {
    const roles = await tx.role.findMany({
      where: { id: { in: [...roleIds] } },
      select: ROLE_GRANTS_SELECT,
    });
    if (roles.length !== roleIds.length) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: 'ROLE' });
    }
    const held = new Set(options.alreadyHeld ?? []);
    if (roles.some((role) => role.code === SUPER_ADMIN_CODE && !held.has(role.id))) {
      throw rpcError('SUPER_ADMIN_NOT_ASSIGNABLE');
    }
    return roles;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: AccountContext,
    action: AuditAction,
    userId: string,
    now: Date,
    metadata: AuditFacts['metadata'],
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      auditRecord({
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        resource: { type: AuditResourceType.USER, id: userId },
        metadata,
        origin: actor.origin,
        now,
      }),
    );
  }
}

/** `PERMISSION_DENIED` naming the missing codes, when there are any. */
function requireNone(lacking: readonly string[]): void {
  if (lacking.length > 0) throw rpcError('PERMISSION_DENIED', { required: [...lacking] });
}

/** A role change needs a live account: neither deactivated nor erased. */
function requireLive(target: AdminUserRow): void {
  if (target.erasedAt !== null) throw rpcError('INVALID_STATE', { status: 'ERASED' });
  if (target.deletedAt !== null) throw rpcError('INVALID_STATE', { status: 'DEACTIVATED' });
}

/** The shape the permission read takes. */
function grantsOf(roles: readonly RoleGrantsRow[]): RoleGrants[] {
  return roles.map((role) => ({
    code: role.code,
    permissions: role.permissions.map(({ permission }) => permission),
  }));
}

function sameCodes(a: readonly string[], b: readonly string[]): boolean {
  const left = a.toSorted(compareStrings);
  const right = b.toSorted(compareStrings);
  return left.length === right.length && left.every((code, index) => code === right[index]);
}
