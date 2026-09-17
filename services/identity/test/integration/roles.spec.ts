import {
  AuditAction,
  compareStrings,
  PERMISSION_CODES,
  PERMISSION_GROUPS,
  PERMISSIONS,
  SystemRole,
} from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RETIRED_TEST_CODE, testPrisma, truncateAll } from '../setup/database';
import { errorOf, staffAccount } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const { roles } = identityServices(prisma);

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

const superAdmin = () => staffAccount(prisma, [SystemRole.SUPER_ADMIN]);

async function roleId(code: string): Promise<string> {
  return (await prisma.role.findUniqueOrThrow({ where: { code } })).id;
}

async function outbox(subject: string) {
  const rows = await prisma.outboxEvent.findMany({ where: { subject }, orderBy: { id: 'asc' } });
  return rows.map((row) => row.payload as Record<string, unknown>);
}

async function auditOf(action: AuditAction) {
  return (await outbox('audit.record')).filter((payload) => payload.action === action);
}

async function retireTestCode(): Promise<void> {
  await prisma.permission.create({
    data: { code: RETIRED_TEST_CODE, group: 'USERS', description: 'Retired.', isRetired: true },
  });
}

describe('ListRoles', () => {
  it('lists system roles first, then by name, counting live holders only', async () => {
    const actor = await superAdmin();
    await staffAccount(prisma, [SystemRole.ADMIN]);
    await staffAccount(prisma, [SystemRole.ADMIN], { deletedAt: new Date() });
    const { roles: listed } = await roles.listRoles(actor.context);
    const codes = listed.map((role) => role.code);
    expect(codes.slice(0, 4).toSorted(compareStrings)).toEqual(
      [SystemRole.ADMIN, SystemRole.SUPER_ADMIN, SystemRole.USER, SystemRole.VENUE_OWNER].toSorted(
        compareStrings,
      ),
    );
    expect(codes).toContain('CONTENT_MODERATOR');
    const adminRole = listed.find((role) => role.code === (SystemRole.ADMIN as string));
    expect(adminRole).toMatchObject({ isSystem: true, holders: 1 });
    expect(adminRole?.permissionCodes).toEqual(adminRole?.permissionCodes.toSorted(compareStrings));
  });
});

describe('CreateRole', () => {
  it('generates a permanent code, suffixed on a collision, and audits it', async () => {
    const actor = await superAdmin();
    const { role } = await roles.createRole(
      { name: 'Đặng  Bảo', description: 'Support', permissionCodes: ['user.read', 'audit.read'] },
      actor.context,
    );
    expect(role).toMatchObject({
      code: 'CUSTOM_DANG_BAO',
      name: 'Đặng Bảo',
      description: 'Support',
      isSystem: false,
      permissionCodes: ['audit.read', 'user.read'],
      holders: 0,
    });
    const { role: second } = await roles.createRole(
      { name: 'Dang Bao', permissionCodes: [] },
      actor.context,
    );
    expect(second?.code).toBe('CUSTOM_DANG_BAO_2');
    expect(second?.description).toBeUndefined();
    const [audit] = await auditOf(AuditAction.ROLE_CREATED);
    expect(audit).toMatchObject({
      resource: { type: 'ROLE', id: role!.id },
      metadata: {
        after: {
          code: 'CUSTOM_DANG_BAO',
          name: 'Đặng Bảo',
          permissionCodes: ['audit.read', 'user.read'],
        },
      },
    });
  });

  it('refuses a taken name, an unknown code, a retired code and an escalation', async () => {
    const actor = await superAdmin();
    await retireTestCode();
    const create = (name: string, permissionCodes: string[], context = actor.context) =>
      errorOf(roles.createRole({ name, permissionCodes }, context));
    expect((await create('Admin', [])).code).toBe('ROLE_NAME_TAKEN');
    expect(await create('A', ['user.read', 'nothing.here'])).toEqual({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: '/permissionCodes/0', code: 'invalid_value' }] },
    });
    expect(await create('B', [RETIRED_TEST_CODE])).toEqual({
      code: 'PERMISSION_RETIRED',
      details: { codes: [RETIRED_TEST_CODE] },
    });
    expect((await create('C', ['Not A Code'])).code).toBe('VALIDATION_FAILED');
    const admin = await staffAccount(prisma, [SystemRole.ADMIN]);
    expect(await create('D', ['user.read', 'role.update'], admin.context)).toEqual({
      code: 'PERMISSION_DENIED',
      details: { required: ['role.update'] },
    });
    expect(
      await prisma.role.count({ where: { isSystem: false, code: { startsWith: 'CUSTOM' } } }),
    ).toBe(0);
  });
});

describe('UpdateRole', () => {
  it('renames and clears the description, never the code', async () => {
    const actor = await superAdmin();
    const { role } = await roles.createRole(
      { name: 'Support', description: 'Desk', permissionCodes: [] },
      actor.context,
    );
    const { role: updated } = await roles.updateRole(
      { roleId: role!.id, name: 'Help desk', description: '' },
      actor.context,
    );
    expect(updated).toMatchObject({ code: 'CUSTOM_SUPPORT', name: 'Help desk' });
    expect(updated?.description).toBeUndefined();
    const [audit] = await auditOf(AuditAction.ROLE_UPDATED);
    expect(audit?.metadata).toEqual({
      before: { name: 'Support', description: 'Desk' },
      after: { name: 'Help desk', description: null },
    });
    await roles.updateRole({ roleId: role!.id, name: 'Help desk' }, actor.context);
    expect(await auditOf(AuditAction.ROLE_UPDATED)).toHaveLength(1);
  });

  it('refuses a system role, a taken name and an unknown id', async () => {
    const actor = await superAdmin();
    const { role } = await roles.createRole(
      { name: 'Support', permissionCodes: [] },
      actor.context,
    );
    const update = (roleId: string, name: string) =>
      errorOf(roles.updateRole({ roleId, name }, actor.context));
    expect((await update(await roleId(SystemRole.ADMIN), 'X')).code).toBe('SYSTEM_ROLE_READ_ONLY');
    expect((await update(role!.id, 'Admin')).code).toBe('ROLE_NAME_TAKEN');
    expect(await update('01990000-0000-7000-8000-0000000000ff', 'X')).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'ROLE' },
    });
  });
});

describe('SetRolePermissions', () => {
  it('replaces the grants and bumps each live holder once, revoking nothing', async () => {
    const actor = await superAdmin();
    const { role } = await roles.createRole(
      { name: 'Support', permissionCodes: ['user.read'] },
      actor.context,
    );
    const holderA = await staffAccount(prisma, ['CUSTOM_SUPPORT']);
    const holderB = await staffAccount(prisma, ['CUSTOM_SUPPORT']);
    await staffAccount(prisma, ['CUSTOM_SUPPORT'], { deletedAt: new Date() });
    await prisma.outboxEvent.deleteMany();

    const { role: updated } = await roles.setRolePermissions(
      { roleId: role!.id, permissionCodes: ['user.read', 'audit.read', 'user.read'] },
      actor.context,
    );
    expect(updated).toMatchObject({ permissionCodes: ['audit.read', 'user.read'], holders: 2 });
    const events = await outbox('identity.session.revoked');
    expect(events.map((event) => String(event.userId)).toSorted(compareStrings)).toEqual(
      [holderA.id, holderB.id].toSorted(compareStrings),
    );
    expect(events.every((event) => event.reason === 'PERMISSIONS_CHANGED')).toBe(true);
    expect(events.every((event) => event.familyIds === null)).toBe(true);
    const [audit] = await auditOf(AuditAction.ROLE_PERMISSIONS_UPDATED);
    expect(audit?.metadata).toEqual({
      before: { permissionCodes: ['user.read'] },
      after: { permissionCodes: ['audit.read', 'user.read'], holders: 2 },
    });

    await roles.setRolePermissions(
      { roleId: role!.id, permissionCodes: ['audit.read', 'user.read'] },
      actor.context,
    );
    expect(await outbox('identity.session.revoked')).toHaveLength(2);
  });

  it('refuses above the holder limit, naming both numbers', async () => {
    const actor = await superAdmin();
    const { roles: narrow } = identityServices(prisma, {}, { roleHoldersLimit: 1 });
    const { role } = await roles.createRole(
      { name: 'Support', permissionCodes: [] },
      actor.context,
    );
    await staffAccount(prisma, ['CUSTOM_SUPPORT']);
    await staffAccount(prisma, ['CUSTOM_SUPPORT']);
    expect(
      await errorOf(
        narrow.setRolePermissions(
          { roleId: role!.id, permissionCodes: ['user.read'] },
          actor.context,
        ),
      ),
    ).toEqual({ code: 'ROLE_TOO_WIDE_TO_EDIT', details: { holders: 2, limit: 1 } });
  });

  it('refuses a system role, a retired code and an addition the actor lacks', async () => {
    const actor = await superAdmin();
    await retireTestCode();
    const { role } = await roles.createRole(
      { name: 'Support', permissionCodes: ['role.update'] },
      actor.context,
    );
    const set = (roleId: string, permissionCodes: string[], context = actor.context) =>
      errorOf(roles.setRolePermissions({ roleId, permissionCodes }, context));
    expect((await set(await roleId(SystemRole.ADMIN), [])).code).toBe('SYSTEM_ROLE_READ_ONLY');
    expect((await set(role!.id, [RETIRED_TEST_CODE])).code).toBe('PERMISSION_RETIRED');
    const admin = await staffAccount(prisma, [SystemRole.ADMIN]);
    expect(await set(role!.id, ['role.update', 'billing.refund.create'], admin.context)).toEqual({
      code: 'PERMISSION_DENIED',
      details: { required: ['billing.refund.create'] },
    });
    // Removing a code the actor lacks is not an escalation.
    await roles.setRolePermissions({ roleId: role!.id, permissionCodes: [] }, admin.context);
  });
});

describe('DeleteRole', () => {
  it('refuses while anyone holds it, deactivated accounts included', async () => {
    const actor = await superAdmin();
    const { role } = await roles.createRole(
      { name: 'Support', permissionCodes: [] },
      actor.context,
    );
    await staffAccount(prisma, ['CUSTOM_SUPPORT'], { deletedAt: new Date() });
    expect(await errorOf(roles.deleteRole({ roleId: role!.id }, actor.context))).toEqual({
      code: 'ROLE_IN_USE',
      details: { holders: 1 },
    });
  });

  it('the foreign key refuses the delete even without the service check', async () => {
    const actor = await superAdmin();
    const { role } = await roles.createRole(
      { name: 'Support', permissionCodes: [] },
      actor.context,
    );
    await staffAccount(prisma, ['CUSTOM_SUPPORT']);
    await expect(prisma.role.delete({ where: { id: role!.id } })).rejects.toThrow();
    expect(await prisma.role.count({ where: { id: role!.id } })).toBe(1);
  });

  it('deletes an unheld custom role with its grants, audited; never a system role', async () => {
    const actor = await superAdmin();
    const { role } = await roles.createRole(
      { name: 'Support', permissionCodes: ['user.read'] },
      actor.context,
    );
    await roles.deleteRole({ roleId: role!.id }, actor.context);
    expect(await prisma.role.count({ where: { id: role!.id } })).toBe(0);
    expect(await prisma.rolePermission.count({ where: { roleId: role!.id } })).toBe(0);
    const [audit] = await auditOf(AuditAction.ROLE_DELETED);
    expect(audit?.metadata).toEqual({
      before: { code: 'CUSTOM_SUPPORT', name: 'Support', permissionCodes: ['user.read'] },
    });
    expect(
      (await errorOf(roles.deleteRole({ roleId: await roleId(SystemRole.USER) }, actor.context)))
        .code,
    ).toBe('SYSTEM_ROLE_READ_ONLY');
  });
});

describe('ListPermissions', () => {
  it('groups the catalogue in code order, retired codes last', async () => {
    const actor = await superAdmin();
    await retireTestCode();
    const { groups } = await roles.listPermissions(actor.context);
    expect(groups.map((group) => group.group)).toEqual([...PERMISSION_GROUPS]);
    const users = groups.find((group) => group.group === 'USERS');
    const expected = PERMISSION_CODES.filter((code) => PERMISSIONS[code].group === 'USERS');
    expect(users?.permissions.map((permission) => permission.code)).toEqual([
      ...expected,
      RETIRED_TEST_CODE,
    ]);
    expect(users?.permissions.at(-1)?.isRetired).toBe(true);
    expect(groups.flatMap((group) => group.permissions)).toHaveLength(PERMISSION_CODES.length + 1);
  });
});
