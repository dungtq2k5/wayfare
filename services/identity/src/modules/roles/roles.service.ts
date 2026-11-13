import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  compareStrings,
  MAX_ROLE_DESCRIPTION_LENGTH,
  MAX_ROLE_NAME_LENGTH,
  normalizeText,
  PERMISSION_CODES,
  PERMISSION_GROUPS,
  roleCodeCandidates,
  roleCodeFromName,
  zPermissionCodeShape,
  zUuidV7,
} from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  isUniqueConstraintViolation,
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { AccessService } from '../access/access.service';
import { addedCodesActorLacks } from '../admin-users/domain/escalation';
import { auditRecord } from '../audit/domain/audit-record';
import type { AuditFacts } from '../audit/domain/audit-record';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { ROLE_VIEW_SELECT, toRole } from './role.mapper';
import type { RoleViewRow } from './role.mapper';

/** Injection token: the most live holders one role-permission change may touch. */
export const ROLE_HOLDERS_LIMIT = Symbol('ROLE_HOLDERS_LIMIT');

const zRoleName = z
  .string()
  .transform(normalizeText)
  .pipe(
    z
      .string()
      .min(1)
      .max(MAX_ROLE_NAME_LENGTH)
      .regex(/^[^\n]*$/),
  );

// An empty description clears it.
const zRoleDescription = z
  .string()
  .transform(normalizeText)
  .pipe(z.string().max(MAX_ROLE_DESCRIPTION_LENGTH))
  .transform((value) => (value === '' ? null : value));

const zCodes = z
  .array(zPermissionCodeShape)
  .max(PERMISSION_CODES.length)
  .transform((codes) => [...new Set(codes)].toSorted(compareStrings));

const createFields = z.object({
  name: zRoleName,
  description: zRoleDescription.optional(),
  permissionCodes: zCodes,
});

const updateFields = z.object({
  roleId: zUuidV7,
  name: zRoleName.optional(),
  description: zRoleDescription.optional(),
});

const setPermissionsFields = z.object({ roleId: zUuidV7, permissionCodes: zCodes });

const roleIdField = z.object({ roleId: zUuidV7 });

/** A role, locked for the rest of the transaction; missing → `RESOURCE_NOT_FOUND`. */
interface LockedRole {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly permissionCodes: string[];
}

/**
 * Custom roles and the permission catalogue (api-endpoints-plan §1.6, rdm-spec I-4 to I-7).
 * System roles are read-only here; their grants are code (ADR 0044).
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly access: AccessService,
    private readonly sessions: SessionsService,
    @Inject(ROLE_HOLDERS_LIMIT) private readonly holdersLimit: number,
  ) {}

  /** Every role, system roles first, then by name. */
  async listRoles(context: RequestContext): Promise<identityGrpc.ListRolesResponse> {
    requireAccountContext(context);
    const rows = await this.prisma.role.findMany({ select: ROLE_VIEW_SELECT });
    const sorted = rows.toSorted(
      (a, b) => Number(b.isSystem) - Number(a.isSystem) || compareStrings(a.name, b.name),
    );
    return { roles: sorted.map(toRole) };
  }

  /** Creates a custom role with a generated, permanent code. No escalation (api §1.6). */
  async createRole(
    request: identityGrpc.CreateRoleRequest,
    context: RequestContext,
  ): Promise<identityGrpc.CreateRoleResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(createFields, request);
    const now = new Date();
    try {
      const role = await this.prisma.$transaction(async (tx) => {
        await this.access.requireAssignableCodes(tx, fields.permissionCodes, '/permissionCodes');
        await this.requireNoEscalation(tx, actor, [], fields.permissionCodes);
        await this.requireNameFree(tx, fields.name, null);
        const code = await this.freeCode(tx, roleCodeFromName(fields.name));
        const created = await tx.role.create({
          data: {
            code,
            name: fields.name,
            description: fields.description ?? null,
            permissions: {
              createMany: {
                data: fields.permissionCodes.map((permissionCode) => ({ permissionCode })),
              },
            },
          },
          select: ROLE_VIEW_SELECT,
        });
        await this.audit(tx, actor, AuditAction.ROLE_CREATED, created.id, now, {
          after: { code, name: created.name, permissionCodes: fields.permissionCodes },
        });
        return created;
      });
      return { role: toRole(role) };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw rpcError('ROLE_NAME_TAKEN');
      throw error;
    }
  }

  /** Renames or re-describes a custom role. The code never changes: audit rows cite it. */
  async updateRole(
    request: identityGrpc.UpdateRoleRequest,
    context: RequestContext,
  ): Promise<identityGrpc.UpdateRoleResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(updateFields, request);
    const now = new Date();
    try {
      const role = await this.prisma.$transaction(async (tx) => {
        const current = await this.lockCustomRole(tx, fields.roleId);
        const name = fields.name ?? current.name;
        const description =
          fields.description === undefined ? current.description : fields.description;
        if (name === current.name && description === current.description) {
          return this.view(tx, current.id);
        }
        if (name !== current.name) await this.requireNameFree(tx, name, current.id);
        await tx.role.update({
          where: { id: current.id },
          data: { name, description },
          select: { id: true },
        });
        await this.audit(tx, actor, AuditAction.ROLE_UPDATED, current.id, now, {
          before: { name: current.name, description: current.description },
          after: { name, description },
        });
        return this.view(tx, current.id);
      });
      return { role: toRole(role) };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw rpcError('ROLE_NAME_TAKEN');
      throw error;
    }
  }

  /**
   * Replaces a custom role's grants and bumps every live holder's token cutoff, so the change
   * reaches the gateway within seconds. No escalation; refused on a role too wide to edit at once.
   */
  async setRolePermissions(
    request: identityGrpc.SetRolePermissionsRequest,
    context: RequestContext,
  ): Promise<identityGrpc.SetRolePermissionsResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(setPermissionsFields, request);
    const now = new Date();
    const role = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockCustomRole(tx, fields.roleId);
      await this.access.requireAssignableCodes(tx, fields.permissionCodes, '/permissionCodes');
      await this.requireNoEscalation(tx, actor, current.permissionCodes, fields.permissionCodes);
      const same =
        current.permissionCodes.length === fields.permissionCodes.length &&
        current.permissionCodes.every((code, index) => code === fields.permissionCodes[index]);
      if (same) return this.view(tx, current.id);

      const holders = await tx.userRole.findMany({
        where: { roleId: current.id, user: { deletedAt: null } },
        select: { userId: true },
      });
      if (holders.length > this.holdersLimit) {
        throw rpcError('ROLE_TOO_WIDE_TO_EDIT', {
          holders: holders.length,
          limit: this.holdersLimit,
        });
      }
      await tx.rolePermission.deleteMany({ where: { roleId: current.id } });
      await tx.rolePermission.createMany({
        data: fields.permissionCodes.map((permissionCode) => ({
          roleId: current.id,
          permissionCode,
        })),
      });
      await this.sessions.bumpCutoff(
        tx,
        holders.map((holder) => holder.userId),
        now,
      );
      await this.audit(tx, actor, AuditAction.ROLE_PERMISSIONS_UPDATED, current.id, now, {
        before: { permissionCodes: current.permissionCodes },
        after: { permissionCodes: fields.permissionCodes, holders: holders.length },
      });
      return this.view(tx, current.id);
    });
    return { role: toRole(role) };
  }

  /**
   * Deletes a custom role nobody holds — deactivated accounts included. The service's count is the
   * message; `user_roles`' RESTRICT key is the guarantee.
   */
  async deleteRole(
    request: identityGrpc.DeleteRoleRequest,
    context: RequestContext,
  ): Promise<identityGrpc.DeleteRoleResponse> {
    const actor = requireAccountContext(context);
    const { roleId } = parseRpcRequest(roleIdField, request);
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await this.lockCustomRole(tx, roleId);
        const holders = await tx.userRole.count({ where: { roleId } });
        if (holders > 0) throw rpcError('ROLE_IN_USE', { holders });
        await tx.role.delete({ where: { id: roleId }, select: { id: true } });
        await this.audit(tx, actor, AuditAction.ROLE_DELETED, roleId, now, {
          before: {
            code: current.code,
            name: current.name,
            permissionCodes: current.permissionCodes,
          },
        });
      });
    } catch (error) {
      if (!isForeignKeyViolation(error)) throw error;
      // A grant raced the delete; the key refused it.
      const holders = await this.prisma.userRole.count({ where: { roleId } });
      throw rpcError('ROLE_IN_USE', { holders: Math.max(holders, 1) });
    }
    return {};
  }

  /**
   * The catalogue by group: groups in `PERMISSION_GROUPS` order, codes in `PERMISSION_CODES`
   * order, retired codes last within their group.
   */
  async listPermissions(context: RequestContext): Promise<identityGrpc.ListPermissionsResponse> {
    requireAccountContext(context);
    const rows = await this.prisma.permission.findMany({
      select: { code: true, group: true, description: true, isRetired: true },
    });
    const groupOrder: readonly string[] = PERMISSION_GROUPS;
    const codeOrder: readonly string[] = PERMISSION_CODES;
    const rank = (list: readonly string[], value: string) => {
      const index = list.indexOf(value);
      return index < 0 ? list.length : index;
    };
    const sorted = rows.toSorted(
      (a, b) =>
        rank(groupOrder, a.group) - rank(groupOrder, b.group) ||
        compareStrings(a.group, b.group) ||
        Number(a.isRetired) - Number(b.isRetired) ||
        rank(codeOrder, a.code) - rank(codeOrder, b.code) ||
        compareStrings(a.code, b.code),
    );
    const groups: identityGrpc.PermissionGroupView[] = [];
    for (const row of sorted) {
      const last = groups.at(-1);
      const view = { code: row.code, description: row.description, isRetired: row.isRetired };
      if (last?.group === row.group) last.permissions.push(view);
      else groups.push({ group: row.group, permissions: [view] });
    }
    return { groups };
  }

  /** Locks the role row; a system role is `SYSTEM_ROLE_READ_ONLY`. */
  private async lockCustomRole(tx: Prisma.TransactionClient, roleId: string): Promise<LockedRole> {
    await tx.$queryRaw`SELECT id FROM roles WHERE id = ${roleId}::uuid FOR UPDATE`;
    const role = await tx.role.findUnique({
      where: { id: roleId },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        isSystem: true,
        permissions: { select: { permissionCode: true } },
      },
    });
    if (role === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'ROLE' });
    if (role.isSystem) throw rpcError('SYSTEM_ROLE_READ_ONLY');
    return {
      ...role,
      permissionCodes: role.permissions
        .map((grant) => grant.permissionCode)
        .toSorted(compareStrings),
    };
  }

  /** `PERMISSION_DENIED` listing the added codes the actor, read from the database, lacks. */
  private async requireNoEscalation(
    tx: Prisma.TransactionClient,
    actor: AccountContext,
    before: readonly string[],
    after: readonly string[],
  ): Promise<void> {
    const { permissions: actorCodes } = await this.access.accessOf(tx, actor.userId);
    const lacking = addedCodesActorLacks({ actorCodes, before, after });
    if (lacking.length > 0) throw rpcError('PERMISSION_DENIED', { required: lacking });
  }

  /** The unique index is the guarantee; this is the message. */
  private async requireNameFree(
    tx: Prisma.TransactionClient,
    name: string,
    exceptRoleId: string | null,
  ): Promise<void> {
    const taken = await tx.role.findUnique({ where: { name }, select: { id: true } });
    if (taken !== null && taken.id !== exceptRoleId) throw rpcError('ROLE_NAME_TAKEN');
  }

  /** The first unused candidate for a generated code. */
  private async freeCode(tx: Prisma.TransactionClient, base: string): Promise<string> {
    const used = await tx.role.findMany({
      where: { code: { startsWith: base } },
      select: { code: true },
    });
    const taken = new Set(used.map((row) => row.code));
    for (const candidate of roleCodeCandidates(base)) {
      if (!taken.has(candidate)) return candidate;
    }
    throw rpcError('INVALID_STATE', { status: 'CODE_EXHAUSTED' });
  }

  private view(tx: Prisma.TransactionClient, roleId: string): Promise<RoleViewRow> {
    return tx.role.findUniqueOrThrow({ where: { id: roleId }, select: ROLE_VIEW_SELECT });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: AccountContext,
    action: AuditAction,
    roleId: string,
    now: Date,
    metadata: AuditFacts['metadata'],
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      auditRecord({
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        resource: { type: AuditResourceType.ROLE, id: roleId },
        metadata,
        origin: actor.origin,
        now,
      }),
    );
  }
}

/** Prisma's foreign-key violation (`P2003`), or the driver's `23503` beneath it. */
function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const text = JSON.stringify(error, Object.getOwnPropertyNames(error));
  return ('code' in error && error.code === 'P2003') || text.includes('23503');
}
