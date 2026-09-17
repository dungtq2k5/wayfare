import { Injectable } from '@nestjs/common';
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

  /** Grants a role by code. The catalogue sync guarantees the system roles exist. */
  async assignRole(tx: Prisma.TransactionClient, userId: string, roleCode: string): Promise<void> {
    const role = await tx.role.findUniqueOrThrow({
      where: { code: roleCode },
      select: { id: true },
    });
    await tx.userRole.create({ data: { userId, roleId: role.id }, select: { userId: true } });
  }
}
