import {
  compareStrings,
  DEFAULT_ROLES,
  PERMISSION_CODES,
  PERMISSIONS,
  SYSTEM_ROLE_GRANTS,
} from '@wayfare/contracts';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CATALOG,
  syncSystemCatalog,
} from '../../src/modules/system-catalog/system-catalog.service';
import { testPrisma } from '../setup/database';

const prisma = testPrisma();

async function snapshot() {
  const permissions = await prisma.permission.findMany({ orderBy: { code: 'asc' } });
  const roles = await prisma.role.findMany({
    orderBy: { code: 'asc' },
    include: { permissions: { orderBy: { permissionCode: 'asc' } } },
  });
  return { permissions, roles };
}

async function restore(): Promise<void> {
  await prisma.role.deleteMany({ where: { code: 'CONTENT_MODERATOR' } });
  await prisma.permission.deleteMany({ where: { code: 'test.gone' } });
  await syncSystemCatalog(prisma);
}

afterEach(restore);
afterAll(() => prisma.$disconnect());

describe('system catalogue sync', () => {
  it('mirrors every code, the system roles and their grants', async () => {
    const { permissions, roles } = await snapshot();
    expect(
      permissions
        .filter((row) => !row.isRetired)
        .map((row) => row.code)
        .toSorted(compareStrings),
    ).toEqual([...PERMISSION_CODES].toSorted(compareStrings));
    const admin = roles.find((role) => role.code === 'ADMIN');
    expect(admin?.isSystem).toBe(true);
    expect(admin?.permissions.map((row) => row.permissionCode).toSorted(compareStrings)).toEqual(
      [...SYSTEM_ROLE_GRANTS.ADMIN].toSorted(compareStrings),
    );
    const moderator = roles.find((role) => role.code === 'CONTENT_MODERATOR');
    expect(moderator?.isSystem).toBe(false);
    expect(moderator?.permissions).toHaveLength(DEFAULT_ROLES.CONTENT_MODERATOR.length);
  });

  it('changes nothing on a second run', async () => {
    const before = await snapshot();
    await syncSystemCatalog(prisma);
    const after = await snapshot();
    const stable = (s: typeof before) => ({
      permissions: s.permissions.map(({ updatedAt: _u, ...row }) => row),
      roles: s.roles.map(({ updatedAt: _u, ...row }) => row),
    });
    expect(stable(after)).toEqual(stable(before));
  });

  it('retires a code the catalogue no longer has, without deleting it', async () => {
    await prisma.permission.create({
      data: { code: 'test.gone', group: 'AUDIT', description: 'x' },
    });
    await syncSystemCatalog(prisma, DEFAULT_CATALOG);
    expect(await prisma.permission.findUnique({ where: { code: 'test.gone' } })).toMatchObject({
      isRetired: true,
    });

    const { 'audit.read': _dropped, ...fewer } = PERMISSIONS;
    const grants = Object.fromEntries(
      Object.entries(SYSTEM_ROLE_GRANTS).map(([role, codes]) => [
        role,
        codes.filter((code) => code !== 'audit.read'),
      ]),
    ) as unknown as typeof SYSTEM_ROLE_GRANTS;
    await syncSystemCatalog(prisma, {
      ...DEFAULT_CATALOG,
      permissions: fewer,
      systemGrants: grants,
    });
    expect(await prisma.permission.findUnique({ where: { code: 'audit.read' } })).toMatchObject({
      isRetired: true,
    });
  });

  it("keeps an admin's edit of CONTENT_MODERATOR", async () => {
    const moderator = await prisma.role.findUniqueOrThrow({ where: { code: 'CONTENT_MODERATOR' } });
    await prisma.rolePermission.deleteMany({ where: { roleId: moderator.id } });
    await syncSystemCatalog(prisma);
    expect(await prisma.rolePermission.count({ where: { roleId: moderator.id } })).toBe(0);
  });

  it('lets two concurrent runs both succeed', async () => {
    await expect(
      Promise.all([syncSystemCatalog(prisma), syncSystemCatalog(prisma)]),
    ).resolves.toBeDefined();
  });
});
