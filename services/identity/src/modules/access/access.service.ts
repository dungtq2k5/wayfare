import { Injectable } from '@nestjs/common';
import { compareStrings, SystemRole } from '@wayfare/contracts';
import { rpcError } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import { isActiveAccount } from '../users/domain/account-state';
import { permissionsOf, roleCodesOf } from './domain/permissions-of';
import type { RoleGrants } from './domain/permissions-of';
import { leavesActiveSuperAdmin, SUPER_ADMIN_LOCK_KEY } from './domain/super-admin-guard';
import type { SuperAdminChange } from './domain/super-admin-guard';

/** A user's roles and the permissions they add up to. */
export interface UserAccess {
  readonly roles: string[];
  readonly permissions: string[];
}

/** Roles → permissions: the one read behind every token and `GetMe` (ADR 0044). */
@Injectable()
export class AccessService {
  /** The user's role codes and effective permission codes, read inside the caller's transaction. */
  async accessOf(tx: Prisma.TransactionClient, userId: string): Promise<UserAccess> {
    const rows = await tx.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            code: true,
            permissions: { select: { permission: { select: { code: true, isRetired: true } } } },
          },
        },
      },
    });
    const roles: RoleGrants[] = rows.map(({ role }) => ({
      code: role.code,
      permissions: role.permissions.map(({ permission }) => permission),
    }));
    return { roles: roleCodesOf(roles), permissions: permissionsOf(roles) };
  }

  /**
   * Serializes every change that could remove an active `SUPER_ADMIN` (rdm-spec I-4): an admin's
   * role change, lock or deactivation, and a super admin's own erasure. Taken before any user row.
   */
  async lockSuperAdmins(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SUPER_ADMIN_LOCK_KEY}))`;
  }

  /** Whether the user holds `SUPER_ADMIN` — the role is never granted here, so no lock is needed. */
  async holdsSuperAdmin(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
    const held = await tx.userRole.findFirst({
      where: { userId, role: { code: SystemRole.SUPER_ADMIN } },
      select: { userId: true },
    });
    return held !== null;
  }

  /** `LAST_SUPER_ADMIN` when the change would leave no active holder. Call under the lock. */
  async requireSuperAdminRemains(
    tx: Prisma.TransactionClient,
    change: SuperAdminChange,
    now: Date,
  ): Promise<void> {
    const holders = await tx.user.findMany({
      where: { roles: { some: { role: { code: SystemRole.SUPER_ADMIN } } } },
      select: { id: true, deletedAt: true, isLocked: true, lockedUntil: true },
    });
    const active = holders.map((holder) => ({
      userId: holder.id,
      active: isActiveAccount(holder, now),
    }));
    if (!leavesActiveSuperAdmin(active, change)) throw rpcError('LAST_SUPER_ADMIN');
  }

  /**
   * Refuses codes an assign route may not grant (rdm-spec I-5): an unknown code is
   * `VALIDATION_FAILED` at `path/<index>` — the gateway may be older than the catalogue — and a
   * retired one is `PERMISSION_RETIRED`, listing them all.
   */
  async requireAssignableCodes(
    tx: Prisma.TransactionClient,
    codes: readonly string[],
    path: string,
  ): Promise<void> {
    if (codes.length === 0) return;
    const rows = await tx.permission.findMany({
      where: { code: { in: [...codes] } },
      select: { code: true, isRetired: true },
    });
    const known = new Map(rows.map((row) => [row.code, row.isRetired]));
    const unknown = codes.flatMap((code, index) => (known.has(code) ? [] : [index]));
    if (unknown.length > 0) {
      throw rpcError('VALIDATION_FAILED', {
        issues: unknown.map((index) => ({ path: `${path}/${index}`, code: 'invalid_value' })),
      });
    }
    const retired = codes.filter((code) => known.get(code) === true).toSorted(compareStrings);
    if (retired.length > 0) throw rpcError('PERMISSION_RETIRED', { codes: retired });
  }

  /** Grants a role by code. The catalogue sync guarantees the system roles exist. */
  async assignRole(tx: Prisma.TransactionClient, userId: string, roleCode: string): Promise<void> {
    const role = await tx.role.findUniqueOrThrow({
      where: { code: roleCode },
      select: { id: true },
    });
    await tx.userRole.create({ data: { userId, roleId: role.id }, select: { userId: true } });
  }
}
