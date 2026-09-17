import {
  ADMIN_EXCLUDED_PERMISSIONS,
  AuditAction,
  compareStrings,
  newId,
  PERMISSION_CODES,
  SystemRole,
} from '@wayfare/contracts';
import { hashToken, toProtoTimestamp } from '@wayfare/nest-common';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BillingPortService } from '../../src/modules/billing-port/billing-port.service';
import type { SellerObligations } from '../../src/modules/billing-port/billing-port.service';
import { testPrisma, truncateAll } from '../setup/database';
import { errorOf, staffAccount } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const services = identityServices(prisma);
const { adminUsers } = services;

const EXCLUDED = [...ADMIN_EXCLUDED_PERMISSIONS].toSorted(compareStrings);
const PAGE = { page: 1, pageSize: 20, sort: '-createdAt' };

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

const superAdmin = (data = {}) => staffAccount(prisma, [SystemRole.SUPER_ADMIN], data);
const admin = (data = {}) => staffAccount(prisma, [SystemRole.ADMIN], data);

async function roleId(code: string): Promise<string> {
  return (await prisma.role.findUniqueOrThrow({ where: { code } })).id;
}

/** A custom role holding the given codes. */
async function customRole(codes: readonly string[], name = `Role ${newId()}`): Promise<string> {
  const role = await prisma.role.create({
    data: {
      code: `CUSTOM_${newId().slice(-12).toUpperCase()}`,
      name,
      permissions: { createMany: { data: codes.map((permissionCode) => ({ permissionCode })) } },
    },
  });
  return role.id;
}

async function openSession(userId: string, client = 'CONSOLE'): Promise<string> {
  const familyId = newId();
  await prisma.session.create({
    data: {
      userId,
      familyId,
      refreshTokenHash: hashToken(newId()),
      client,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return familyId;
}

async function outbox(subject: string) {
  const rows = await prisma.outboxEvent.findMany({ where: { subject }, orderBy: { id: 'asc' } });
  return rows.map((row) => row.payload as Record<string, unknown>);
}

async function auditOf(action: AuditAction) {
  return (await outbox('audit.record')).filter((payload) => payload.action === action);
}

async function rolesOf(userId: string): Promise<string[]> {
  const rows = await prisma.userRole.findMany({ where: { userId }, include: { role: true } });
  return rows.map((row) => row.role.code).toSorted(compareStrings);
}

describe('ListUsers', () => {
  it('pages, filters and hides deactivated accounts unless asked', async () => {
    const actor = await superAdmin();
    const locked = await admin({ isLocked: true });
    await admin({ isLocked: true, lockedUntil: new Date(Date.now() - 1000) }); // lapsed
    const gone = await admin({ deletedAt: new Date() });
    const owner = await staffAccount(prisma, [], { ownerVerifiedAt: new Date() });

    const all = await adminUsers.listUsers({ page: PAGE, includeDeleted: false }, actor.context);
    expect(all.page).toEqual({ page: 1, pageSize: 20, total: 4 });
    expect(all.users.map((item) => item.user?.id)).not.toContain(gone.id);

    const withDeleted = await adminUsers.listUsers(
      { page: PAGE, includeDeleted: true },
      actor.context,
    );
    expect(withDeleted.page?.total).toBe(5);

    const lockedOnly = await adminUsers.listUsers(
      { page: PAGE, includeDeleted: false, isLocked: true },
      actor.context,
    );
    expect(lockedOnly.users.map((item) => item.user?.id)).toEqual([locked.id]);
    expect(lockedOnly.users[0]?.user?.isLocked).toBe(true);

    const admins = await adminUsers.listUsers(
      { page: PAGE, includeDeleted: false, roleId: await roleId(SystemRole.ADMIN) },
      actor.context,
    );
    expect(admins.page?.total).toBe(2);

    const owners = await adminUsers.listUsers(
      { page: PAGE, includeDeleted: false, ownerVerified: true },
      actor.context,
    );
    expect(owners.users.map((item) => item.user?.id)).toEqual([owner.id]);

    const second = await adminUsers.listUsers(
      { page: { ...PAGE, pageSize: 3, page: 2 }, includeDeleted: false },
      actor.context,
    );
    expect(second.users).toHaveLength(1);
    expect(second.page).toEqual({ page: 2, pageSize: 3, total: 4 });
  });

  it('shows an erased account as a placeholder only', async () => {
    const actor = await superAdmin();
    const erasedAt = new Date('2026-09-01T00:00:00Z');
    const erased = await staffAccount(prisma, [], { deletedAt: erasedAt, erasedAt });
    const { users } = await adminUsers.listUsers(
      { page: PAGE, includeDeleted: true },
      actor.context,
    );
    const placeholder = users.find((item) => item.erased?.id === erased.id);
    expect(placeholder).toEqual({
      erased: { id: erased.id, erasedAt: toProtoTimestamp(erasedAt) },
    });
  });

  it('searches wildcards literally, by email or name', async () => {
    const actor = await superAdmin({ email: 'actor@example.com' });
    const underscore = await staffAccount(prisma, [], { email: 'a_b@example.com' });
    await staffAccount(prisma, [], { email: 'axb@example.com' });
    const percent = await staffAccount(prisma, [], { fullName: 'Deal 100% off' });
    await staffAccount(prisma, [], { fullName: 'Deal 1000 off' });
    const search = async (q: string) =>
      (
        await adminUsers.listUsers({ page: { ...PAGE, q }, includeDeleted: false }, actor.context)
      ).users.map((item) => item.user?.id);
    expect(await search('a_b')).toEqual([underscore.id]);
    expect(await search('100%')).toEqual([percent.id]);
    expect(await search('A_B@EXAMPLE')).toEqual([underscore.id]);
  });

  it('sorts never-signed-in accounts last in both directions', async () => {
    const actor = await superAdmin();
    const early = await staffAccount(prisma, [], { lastLoginAt: new Date('2026-01-01') });
    const late = await staffAccount(prisma, [], { lastLoginAt: new Date('2026-06-01') });
    const ids = async (sort: string) =>
      (
        await adminUsers.listUsers(
          { page: { ...PAGE, sort }, includeDeleted: false },
          actor.context,
        )
      ).users.map((item) => item.user?.id);
    const ascending = await ids('lastLoginAt');
    const descending = await ids('-lastLoginAt');
    expect(ascending.slice(0, 2)).toEqual([early.id, late.id]);
    expect(descending.slice(0, 2)).toEqual([late.id, early.id]);
    expect(ascending.at(-1)).toBe(actor.id);
    expect(descending.at(-1)).toBe(actor.id);
  });

  it('refuses a sort field outside the allowlist', async () => {
    const actor = await superAdmin();
    const { code } = await errorOf(
      adminUsers.listUsers(
        { page: { ...PAGE, sort: 'passwordHash' }, includeDeleted: false },
        actor.context,
      ),
    );
    expect(code).toBe('VALIDATION_FAILED');
  });
});

describe('GetUser', () => {
  it('adds devices and live sessions by client, and the lock reason while locked', async () => {
    const actor = await superAdmin();
    const target = await admin({ isLocked: true });
    await prisma.user.update({ where: { id: target.id }, data: { lockReason: 'fraud check' } });
    await openSession(target.id, 'CONSOLE');
    await openSession(target.id, 'WEB');
    await openSession(target.id, 'WEB');
    const { user } = await adminUsers.getUser({ userId: target.id }, actor.context);
    expect(user).toMatchObject({
      devicesCount: 0,
      sessions: { live: 3, console: 1, web: 2, mobile: 0 },
      lockReason: 'fraud check',
    });
    expect(user?.user?.roles.map((role) => role.code)).toEqual([SystemRole.ADMIN]);
  });

  it('answers an erased account with its placeholder, and an unknown id with 404', async () => {
    const actor = await superAdmin();
    const erased = await staffAccount(prisma, [], { deletedAt: new Date(), erasedAt: new Date() });
    const response = await adminUsers.getUser({ userId: erased.id }, actor.context);
    expect(response.user).toBeUndefined();
    expect(response.erased?.id).toBe(erased.id);
    expect(await errorOf(adminUsers.getUser({ userId: newId() }, actor.context))).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'USER' },
    });
  });
});

describe('CreateStaffUser', () => {
  it('creates an account with no password and its roles, audited', async () => {
    const actor = await admin();
    const { user } = await adminUsers.createStaffUser(
      {
        email: ' New.Staff@Example.com ',
        fullName: 'New  Staff',
        roleIds: [await roleId(SystemRole.ADMIN)],
      },
      actor.context,
    );
    expect(user).toMatchObject({ email: 'new.staff@example.com', fullName: 'New Staff' });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user!.id } });
    expect(row).toMatchObject({ passwordHash: null, isEmailVerified: false });
    expect(await rolesOf(row.id)).toEqual([SystemRole.ADMIN]);
    const [audit] = await auditOf(AuditAction.STAFF_USER_CREATED);
    expect(audit).toMatchObject({
      actor: { type: 'USER', userId: actor.id },
      resource: { type: 'USER', id: row.id },
      metadata: { after: { roleCodes: [SystemRole.ADMIN] } },
    });
  });

  it('never assigns SUPER_ADMIN', async () => {
    const actor = await superAdmin();
    const { code } = await errorOf(
      adminUsers.createStaffUser(
        {
          email: 'x@example.com',
          fullName: 'X',
          roleIds: [await roleId(SystemRole.SUPER_ADMIN)],
        },
        actor.context,
      ),
    );
    expect(code).toBe('SUPER_ADMIN_NOT_ASSIGNABLE');
  });

  it('caps the new account at its creator’s permissions', async () => {
    const actor = await admin();
    const role = await customRole(['user.read', 'role.update', 'billing.refund.create']);
    expect(
      await errorOf(
        adminUsers.createStaffUser(
          { email: 'x@example.com', fullName: 'X', roleIds: [role] },
          actor.context,
        ),
      ),
    ).toEqual({
      code: 'PERMISSION_DENIED',
      details: { required: ['billing.refund.create', 'role.update'] },
    });
    expect(await prisma.user.count({ where: { email: 'x@example.com' } })).toBe(0);
  });

  it('refuses a taken address, an unknown role and an empty role set', async () => {
    const actor = await superAdmin({ email: 'taken@example.com' });
    const adminRole = await roleId(SystemRole.ADMIN);
    const create = (email: string, roleIds: string[]) =>
      errorOf(adminUsers.createStaffUser({ email, fullName: 'X', roleIds }, actor.context));
    expect((await create('TAKEN@example.com', [adminRole])).code).toBe('EMAIL_TAKEN');
    expect(await create('y@example.com', [newId()])).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'ROLE' },
    });
    expect((await create('y@example.com', [])).code).toBe('VALIDATION_FAILED');
  });
});

describe('UpdateUser', () => {
  it('renames, recording the field and never the value', async () => {
    const actor = await superAdmin();
    const target = await admin({ fullName: 'Old' });
    const { user } = await adminUsers.updateUser(
      { userId: target.id, fullName: 'New' },
      actor.context,
    );
    expect(user?.fullName).toBe('New');
    const [audit] = await auditOf(AuditAction.USER_UPDATED);
    expect(audit?.metadata).toEqual({ after: { changedFields: ['fullName'] } });
    await adminUsers.updateUser({ userId: target.id, fullName: 'New' }, actor.context);
    expect(await auditOf(AuditAction.USER_UPDATED)).toHaveLength(1);
  });

  it('refuses an erased account', async () => {
    const actor = await superAdmin();
    const erased = await staffAccount(prisma, [], { deletedAt: new Date(), erasedAt: new Date() });
    expect(
      await errorOf(adminUsers.updateUser({ userId: erased.id, fullName: 'X' }, actor.context)),
    ).toEqual({ code: 'INVALID_STATE', details: { status: 'ERASED' } });
  });
});

describe('SetUserRoles', () => {
  it('bumps the cutoff without revoking sessions, and audits both sets', async () => {
    const actor = await superAdmin();
    const target = await admin();
    const family = await openSession(target.id);
    const moderator = await roleId('CONTENT_MODERATOR');
    const { user } = await adminUsers.setUserRoles(
      { userId: target.id, roleIds: [moderator] },
      actor.context,
    );
    expect(user?.roles.map((role) => role.code)).toEqual(['CONTENT_MODERATOR']);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.tokensValidAfter).not.toBeNull();
    const session = await prisma.session.findFirstOrThrow({ where: { familyId: family } });
    expect(session.revokedAt).toBeNull();
    expect(await outbox('identity.session.revoked')).toEqual([
      expect.objectContaining({
        userId: target.id,
        familyIds: null,
        tokensValidAfter: row.tokensValidAfter!.toISOString(),
        reason: 'PERMISSIONS_CHANGED',
      }),
    ]);
    const [audit] = await auditOf(AuditAction.USER_ROLES_UPDATED);
    expect(audit?.metadata).toEqual({
      before: { roleCodes: [SystemRole.ADMIN] },
      after: { roleCodes: ['CONTENT_MODERATOR'] },
    });
  });

  it('an unchanged set writes nothing', async () => {
    const actor = await superAdmin();
    const target = await admin();
    await adminUsers.setUserRoles(
      { userId: target.id, roleIds: [await roleId(SystemRole.ADMIN)] },
      actor.context,
    );
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('never adds SUPER_ADMIN, but keeps one already held', async () => {
    const actor = await superAdmin();
    const target = await admin();
    const superRole = await roleId(SystemRole.SUPER_ADMIN);
    expect(
      (
        await errorOf(
          adminUsers.setUserRoles({ userId: target.id, roleIds: [superRole] }, actor.context),
        )
      ).code,
    ).toBe('SUPER_ADMIN_NOT_ASSIGNABLE');
    const other = await superAdmin();
    await adminUsers.setUserRoles(
      { userId: other.id, roleIds: [superRole, await roleId(SystemRole.ADMIN)] },
      actor.context,
    );
    expect(await rolesOf(other.id)).toEqual([SystemRole.ADMIN, SystemRole.SUPER_ADMIN]);
  });

  it('refuses an addition the actor lacks, naming exactly those codes', async () => {
    const actor = await staffAccount(prisma, [SystemRole.ADMIN]);
    const target = await staffAccount(prisma, []);
    const role = await customRole(['user.read', 'role.delete']);
    expect(
      await errorOf(adminUsers.setUserRoles({ userId: target.id, roleIds: [role] }, actor.context)),
    ).toEqual({ code: 'PERMISSION_DENIED', details: { required: ['role.delete'] } });
  });

  it('refuses to remove the last active SUPER_ADMIN, counting only active holders', async () => {
    const actor = await superAdmin();
    await superAdmin({ isLocked: true });
    await superAdmin({ deletedAt: new Date() });
    expect(
      (await errorOf(adminUsers.setUserRoles({ userId: actor.id, roleIds: [] }, actor.context)))
        .code,
    ).toBe('LAST_SUPER_ADMIN');
    await superAdmin();
    await adminUsers.setUserRoles({ userId: actor.id, roleIds: [] }, actor.context);
    expect(await rolesOf(actor.id)).toEqual([]);
  });

  it('two admins removing each other concurrently: exactly one succeeds', async () => {
    const a = await superAdmin();
    const b = await superAdmin();
    const results = await Promise.allSettled([
      adminUsers.setUserRoles({ userId: b.id, roleIds: [] }, a.context),
      adminUsers.setUserRoles({ userId: a.id, roleIds: [] }, b.context),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as unknown;
    // The loser either finds itself the last holder, or has already lost the role it acted with.
    expect(['LAST_SUPER_ADMIN', 'PERMISSION_DENIED']).toContain(
      (await errorOf(Promise.reject(reason as Error))).code,
    );
    const holders = await prisma.userRole.count({
      where: { role: { code: SystemRole.SUPER_ADMIN } },
    });
    expect(holders).toBe(1);
  });

  it('refuses a deactivated account', async () => {
    const actor = await superAdmin();
    const target = await admin({ deletedAt: new Date() });
    expect(
      await errorOf(adminUsers.setUserRoles({ userId: target.id, roleIds: [] }, actor.context)),
    ).toEqual({ code: 'INVALID_STATE', details: { status: 'DEACTIVATED' } });
  });
});

describe('LockUser and UnlockUser', () => {
  it('locks: revokes every session, bumps the cutoff, publishes the lock, audits the reason', async () => {
    const actor = await superAdmin();
    const target = await admin();
    await openSession(target.id);
    await openSession(target.id);
    const lockedUntil = new Date(Date.now() + 86_400_000);
    await adminUsers.lockUser(
      {
        userId: target.id,
        reason: ' Chargeback  review ',
        lockedUntil: toProtoTimestamp(lockedUntil),
      },
      actor.context,
    );
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row).toMatchObject({ isLocked: true, lockReason: 'Chargeback review' });
    expect(row.lockedUntil).toEqual(lockedUntil);
    expect(await prisma.session.count({ where: { userId: target.id, revokedAt: null } })).toBe(0);
    expect(await outbox('identity.session.revoked')).toEqual([
      expect.objectContaining({ familyIds: null, reason: 'LOCKED' }),
    ]);
    expect(await outbox('identity.user.locked')).toEqual([
      expect.objectContaining({ userId: target.id }),
    ]);
    const [audit] = await auditOf(AuditAction.USER_LOCKED);
    expect(audit?.metadata).toEqual({
      after: { lockedUntil: lockedUntil.toISOString() },
      reason: 'Chargeback review',
    });

    await adminUsers.unlockUser({ userId: target.id }, actor.context);
    const unlocked = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(unlocked).toMatchObject({ isLocked: false, lockedUntil: null, lockReason: null });
    await adminUsers.unlockUser({ userId: target.id }, actor.context);
    expect(await auditOf(AuditAction.USER_UNLOCKED)).toEqual([
      expect.objectContaining({
        metadata: { before: { lockedUntil: lockedUntil.toISOString() } },
      }),
    ]);
  });

  it('refuses self, a past or far expiry, and a deactivated account', async () => {
    const actor = await superAdmin();
    const target = await admin();
    const gone = await admin({ deletedAt: new Date() });
    const lock = (userId: string, lockedUntil?: Date) =>
      errorOf(
        adminUsers.lockUser(
          {
            userId,
            reason: 'x',
            lockedUntil: lockedUntil === undefined ? undefined : toProtoTimestamp(lockedUntil),
          },
          actor.context,
        ),
      );
    expect((await lock(actor.id)).code).toBe('SELF_ACTION_FORBIDDEN');
    expect((await lock(target.id, new Date(Date.now() - 1000))).code).toBe('VALIDATION_FAILED');
    expect((await lock(target.id, new Date(Date.now() + 400 * 86_400_000))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(await lock(gone.id)).toEqual({
      code: 'INVALID_STATE',
      details: { status: 'DEACTIVATED' },
    });
  });

  it('refuses to lock the last active SUPER_ADMIN', async () => {
    // An actor holding every code without the role outranks the target, who is the last holder.
    const actor = await staffAccount(prisma, []);
    const everything = await customRole(PERMISSION_CODES);
    await prisma.userRole.create({ data: { userId: actor.id, roleId: everything } });
    const last = await superAdmin();
    expect(
      (
        await errorOf(
          adminUsers.lockUser(
            { userId: last.id, reason: 'x', lockedUntil: undefined },
            actor.context,
          ),
        )
      ).code,
    ).toBe('LAST_SUPER_ADMIN');
  });
});

describe('DeactivateUser and RestoreUser', () => {
  it('deactivates: stamps, revokes, publishes without refund, audits; again is a no-op', async () => {
    const actor = await superAdmin();
    const target = await admin();
    await openSession(target.id);
    await adminUsers.deactivateUser(
      { userId: target.id, reason: 'Left the company', refundUnredeemedVouchers: true },
      actor.context,
    );
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedById).toBe(actor.id);
    expect(row.tokensValidAfter).not.toBeNull();
    expect(await outbox('identity.user.deactivated')).toEqual([
      expect.objectContaining({ userId: target.id, refundUnredeemedVouchers: false }),
    ]);
    expect(await outbox('identity.session.revoked')).toEqual([
      expect.objectContaining({ reason: 'ADMIN', familyIds: null }),
    ]);
    const [audit] = await auditOf(AuditAction.USER_DEACTIVATED);
    expect(audit?.metadata).toEqual({
      after: { wasOwner: false, refundUnredeemedVouchers: false, revokedFamilies: 1 },
      reason: 'Left the company',
    });

    const before = await prisma.outboxEvent.count();
    await adminUsers.deactivateUser(
      { userId: target.id, reason: 'again', refundUnredeemedVouchers: false },
      actor.context,
    );
    expect(await prisma.outboxEvent.count()).toBe(before);

    await adminUsers.restoreUser({ userId: target.id }, actor.context);
    const restored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(restored).toMatchObject({ deletedAt: null, deletedById: null });
    expect(await auditOf(AuditAction.USER_RESTORED)).toHaveLength(1);
    await adminUsers.restoreUser({ userId: target.id }, actor.context);
    expect(await auditOf(AuditAction.USER_RESTORED)).toHaveLength(1);
  });

  it('refuses self and the last active SUPER_ADMIN', async () => {
    const actor = await superAdmin();
    expect(
      (
        await errorOf(
          adminUsers.deactivateUser(
            { userId: actor.id, reason: 'x', refundUnredeemedVouchers: false },
            actor.context,
          ),
        )
      ).code,
    ).toBe('SELF_ACTION_FORBIDDEN');
    const everything = await staffAccount(prisma, []);
    await prisma.userRole.create({
      data: { userId: everything.id, roleId: await customRole(PERMISSION_CODES) },
    });
    expect(
      (
        await errorOf(
          adminUsers.deactivateUser(
            { userId: actor.id, reason: 'x', refundUnredeemedVouchers: false },
            everything.context,
          ),
        )
      ).code,
    ).toBe('LAST_SUPER_ADMIN');
  });

  it('restoring an erased account is INVALID_STATE', async () => {
    const actor = await superAdmin();
    const erased = await staffAccount(prisma, [], { deletedAt: new Date(), erasedAt: new Date() });
    expect(await errorOf(adminUsers.restoreUser({ userId: erased.id }, actor.context))).toEqual({
      code: 'INVALID_STATE',
      details: { status: 'ERASED' },
    });
  });

  describe('an owner', () => {
    class CountingBilling extends BillingPortService {
      constructor(private readonly obligations: SellerObligations) {
        super();
      }

      override getLiveObligations(): Promise<SellerObligations> {
        return Promise.resolve(this.obligations);
      }
    }

    const deactivateOwner = async (
      billing: BillingPortService,
      refundUnredeemedVouchers: boolean,
    ) => {
      const { adminUsers: withBilling } = identityServices(prisma, {}, { billing });
      const actor = await superAdmin();
      const owner = await staffAccount(prisma, [SystemRole.VENUE_OWNER], {
        ownerVerifiedAt: new Date(),
      });
      const result = withBilling
        .deactivateUser(
          { userId: owner.id, reason: 'Fraud', refundUnredeemedVouchers },
          actor.context,
        )
        .then(() => null);
      return { owner, result };
    };

    it('billing unavailable → UPSTREAM_UNAVAILABLE, nothing written', async () => {
      const { owner, result } = await deactivateOwner(new BillingPortService(), true);
      expect((await errorOf(result)).code).toBe('UPSTREAM_UNAVAILABLE');
      const row = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(row.deletedAt).toBeNull();
      expect(await prisma.outboxEvent.count()).toBe(0);
    });

    it('live obligations without a refund → OWNER_HAS_LIVE_VOUCHERS with the counts', async () => {
      const billing = new CountingBilling({ issuedVoucherCount: 3, openCheckoutCount: 1 });
      const { owner, result } = await deactivateOwner(billing, false);
      expect(await errorOf(result)).toEqual({
        code: 'OWNER_HAS_LIVE_VOUCHERS',
        details: { issuedVoucherCount: 3, openCheckoutCount: 1 },
      });
      const row = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(row.deletedAt).toBeNull();
    });

    it('with a refund → deactivated, and the event carries it', async () => {
      const billing = new CountingBilling({ issuedVoucherCount: 3, openCheckoutCount: 0 });
      const { owner, result } = await deactivateOwner(billing, true);
      await result;
      expect(await outbox('identity.user.deactivated')).toEqual([
        expect.objectContaining({ userId: owner.id, refundUnredeemedVouchers: true }),
      ]);
      const [audit] = await auditOf(AuditAction.USER_DEACTIVATED);
      expect(audit?.metadata).toMatchObject({
        after: { wasOwner: true, refundUnredeemedVouchers: true },
      });
    });
  });
});

describe('RevokeUserSessions', () => {
  it('signs a user out everywhere, and is allowed on yourself', async () => {
    const actor = await admin();
    const target = await admin();
    await openSession(target.id);
    await adminUsers.revokeUserSessions({ userId: target.id }, actor.context);
    expect(await prisma.session.count({ where: { userId: target.id, revokedAt: null } })).toBe(0);
    await openSession(actor.id);
    await adminUsers.revokeUserSessions({ userId: actor.id }, actor.context);
    const audits = await auditOf(AuditAction.USER_SESSIONS_REVOKED);
    expect(audits.map((audit) => audit.metadata)).toEqual([
      { after: { revokedFamilies: 1 } },
      { after: { revokedFamilies: 1 } },
    ]);
    expect((await outbox('identity.session.revoked')).map((event) => event.reason)).toEqual([
      'ADMIN',
      'ADMIN',
    ]);
  });
});

describe('no acting above your own level', () => {
  it('an ADMIN is refused on a SUPER_ADMIN by every targeted RPC, naming the excluded codes', async () => {
    const actor = await admin();
    const target = await superAdmin();
    await superAdmin(); // so the last-admin rule is never what refuses
    const userId = target.id;
    const calls: [string, () => Promise<unknown>][] = [
      ['UpdateUser', () => adminUsers.updateUser({ userId, fullName: 'X' }, actor.context)],
      ['SetUserRoles', () => adminUsers.setUserRoles({ userId, roleIds: [] }, actor.context)],
      [
        'LockUser',
        () => adminUsers.lockUser({ userId, reason: 'x', lockedUntil: undefined }, actor.context),
      ],
      ['UnlockUser', () => adminUsers.unlockUser({ userId }, actor.context)],
      [
        'DeactivateUser',
        () =>
          adminUsers.deactivateUser(
            { userId, reason: 'x', refundUnredeemedVouchers: false },
            actor.context,
          ),
      ],
      ['RestoreUser', () => adminUsers.restoreUser({ userId }, actor.context)],
      ['RevokeUserSessions', () => adminUsers.revokeUserSessions({ userId }, actor.context)],
    ];
    for (const [name, call] of calls) {
      expect({ name, ...(await errorOf(call())) }).toEqual({
        name,
        code: 'PERMISSION_DENIED',
        details: { required: EXCLUDED },
      });
    }
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row).toMatchObject({ isLocked: false, deletedAt: null, fullName: null });
  });

  it('an ADMIN acts on another ADMIN', async () => {
    const actor = await admin();
    const target = await admin();
    await adminUsers.lockUser(
      { userId: target.id, reason: 'x', lockedUntil: undefined },
      actor.context,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isLocked).toBe(true);
  });
});
