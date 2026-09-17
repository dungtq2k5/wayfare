import { Injectable } from '@nestjs/common';
import { compareStrings } from '@wayfare/contracts';
import { rpcError } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import { permissionsOf, roleCodesOf } from './domain/permissions-of';
import type { RoleGrants } from './domain/permissions-of';

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
