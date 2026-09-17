import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { DEFAULT_ROLES, PERMISSIONS, SYSTEM_ROLE_GRANTS, SystemRole } from '@wayfare/contracts';
import type { PermissionSpec } from '@wayfare/contracts';
import type { PrismaClient } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** What the sync mirrors — the code catalogue by default, a modified copy in tests. */
export interface SystemCatalog {
  readonly permissions: Readonly<Record<string, PermissionSpec>>;
  readonly systemGrants: Readonly<Record<SystemRole, readonly string[]>>;
  readonly defaultRoles: Readonly<Record<string, readonly string[]>>;
}

/** The catalogue as the code defines it (ADR 0044). */
export const DEFAULT_CATALOG: SystemCatalog = {
  permissions: PERMISSIONS,
  systemGrants: SYSTEM_ROLE_GRANTS,
  defaultRoles: DEFAULT_ROLES,
};

/** The fixed display names of the system roles and the seeded defaults. */
const ROLE_NAMES: Readonly<Record<string, string>> = {
  [SystemRole.SUPER_ADMIN]: 'Super admin',
  [SystemRole.ADMIN]: 'Admin',
  [SystemRole.VENUE_OWNER]: 'Venue owner',
  [SystemRole.USER]: 'User',
  CONTENT_MODERATOR: 'Content moderator',
};

/** Serializes concurrent syncs — two replicas booting together. */
const LOCK_KEY = 'identity:system-catalog';

/** The client surface the sync needs: an interactive transaction. */
type CatalogDb = Pick<PrismaClient, '$transaction'>;

/**
 * Mirrors the permission catalogue and the system roles into I-4, I-5 and I-7 (rdm-spec, ADR 0044),
 * in one transaction under an advisory lock:
 *
 * 1. every code is upserted, every other row retired — never deleted;
 * 2. the system roles are upserted and their grants replaced with the code's;
 * 3. a seeded default role is created only if no role has its code — an admin's edit or deletion stands.
 *
 * A custom role that still holds a retired code keeps the row, so audit history stays readable.
 */
export async function syncSystemCatalog(
  prisma: CatalogDb,
  catalog: SystemCatalog = DEFAULT_CATALOG,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`;

      const codes = Object.keys(catalog.permissions);
      for (const [code, spec] of Object.entries(catalog.permissions)) {
        await tx.permission.upsert({
          where: { code },
          create: { code, group: spec.group, description: spec.description },
          update: { group: spec.group, description: spec.description, isRetired: false },
          select: { code: true },
        });
      }
      await tx.permission.updateMany({
        where: { code: { notIn: codes }, isRetired: false },
        data: { isRetired: true },
      });

      for (const [code, grants] of Object.entries(catalog.systemGrants)) {
        const role = await tx.role.upsert({
          where: { code },
          create: { code, name: ROLE_NAMES[code] ?? code, isSystem: true },
          update: { name: ROLE_NAMES[code] ?? code, isSystem: true },
          select: { id: true },
        });
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.rolePermission.createMany({
          data: grants.map((permissionCode) => ({ roleId: role.id, permissionCode })),
        });
      }

      for (const [code, grants] of Object.entries(catalog.defaultRoles)) {
        const existing = await tx.role.findUnique({ where: { code }, select: { id: true } });
        if (existing !== null) continue;
        await tx.role.create({
          data: {
            code,
            name: ROLE_NAMES[code] ?? code,
            permissions: { create: grants.map((permissionCode) => ({ permissionCode })) },
          },
          select: { id: true },
        });
      }
    },
    { timeout: 30_000 },
  );
}

/** Runs the sync at boot, so the running build and its catalogue are the same thing (D10). */
@Injectable()
export class SystemCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await syncSystemCatalog(this.prisma);
    this.logger.log({ permissions: Object.keys(PERMISSIONS).length }, 'system catalogue synced');
  }
}
