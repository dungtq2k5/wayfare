import { AuditAction, compareStrings, SystemRole } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapInput,
  BootstrapRefused,
  bootstrapSuperAdmin,
  describeOutcome,
} from '../../src/scripts/bootstrap-super-admin';
import { verifyPassword } from '../../src/modules/tokens/domain/password';
import { testPrisma, truncateAll } from '../setup/database';
import { freshEmail, PASSWORD } from '../setup/fixtures';

const prisma = testPrisma();

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

async function rolesOf(userId: string): Promise<string[]> {
  const rows = await prisma.userRole.findMany({
    where: { userId },
    select: { role: { select: { code: true } } },
  });
  return rows.map((row) => row.role.code).toSorted(compareStrings);
}

async function auditActions(): Promise<string[]> {
  const rows = await prisma.outboxEvent.findMany({
    where: { subject: 'audit.record' },
    orderBy: { id: 'asc' },
  });
  return rows.map((row) => (row.payload as { action: string }).action);
}

describe('bootstrap:super-admin', () => {
  it('creates the account once, then changes nothing', async () => {
    const email = freshEmail();
    const first = await bootstrapSuperAdmin(prisma, { email, password: PASSWORD });
    expect(first).toMatchObject({ created: true, granted: true, passwordSet: true });
    expect(describeOutcome(email, first)).toBe(`✓ created ${email} as SUPER_ADMIN`);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: first.userId } });
    expect(user).toMatchObject({ isEmailVerified: true, fullName: null });
    expect(await verifyPassword(user.passwordHash!, PASSWORD)).toBe(true);
    expect(await rolesOf(user.id)).toEqual([SystemRole.SUPER_ADMIN]);
    expect(await auditActions()).toEqual([
      AuditAction.STAFF_USER_CREATED,
      AuditAction.USER_ROLES_UPDATED,
    ]);
    const events = await prisma.outboxEvent.findMany({ where: { subject: 'audit.record' } });
    expect(events.map((row) => (row.payload as { actor: unknown }).actor)).toEqual([
      { type: 'SYSTEM' },
      { type: 'SYSTEM' },
    ]);

    const second = await bootstrapSuperAdmin(prisma, { email, password: 'another password!' });
    expect(second).toEqual({
      userId: first.userId,
      created: false,
      granted: false,
      passwordSet: false,
    });
    expect(describeOutcome(email, second)).toContain('nothing to do');
    expect(await auditActions()).toHaveLength(2);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: first.userId } });
    expect(after.passwordHash).toBe(user.passwordHash);
  });

  it('grants the role to a live account, bumping its cutoff, and keeps its password', async () => {
    const email = freshEmail();
    const user = await prisma.user.create({
      data: { email, passwordHash: 'existing-hash' },
    });
    const outcome = await bootstrapSuperAdmin(prisma, { email, password: PASSWORD });
    expect(outcome).toMatchObject({ created: false, granted: true, passwordSet: false });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toBe('existing-hash');
    expect(after.tokensValidAfter).not.toBeNull();
    expect(await rolesOf(user.id)).toEqual([SystemRole.SUPER_ADMIN]);
    const revoked = await prisma.outboxEvent.findFirstOrThrow({
      where: { subject: 'identity.session.revoked' },
    });
    expect(revoked.payload).toMatchObject({
      userId: user.id,
      familyIds: null,
      reason: 'PERMISSIONS_CHANGED',
    });
    expect(await auditActions()).toEqual([AuditAction.USER_ROLES_UPDATED]);
  });

  it('fills the password of a staff account created without one', async () => {
    const email = freshEmail();
    const user = await prisma.user.create({ data: { email } });
    const outcome = await bootstrapSuperAdmin(prisma, { email, password: PASSWORD });
    expect(outcome).toMatchObject({ granted: true, passwordSet: true });
    expect(describeOutcome(email, outcome)).toBe(`✓ ${email}: granted SUPER_ADMIN, password set`);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(after.passwordHash!, PASSWORD)).toBe(true);
    expect(after.isEmailVerified).toBe(true);
  });

  it('refuses a deactivated account and writes nothing', async () => {
    const email = freshEmail();
    await prisma.user.create({ data: { email, deletedAt: new Date() } });
    await expect(bootstrapSuperAdmin(prisma, { email, password: PASSWORD })).rejects.toThrow(
      BootstrapRefused,
    );
    expect(await prisma.userRole.count()).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('validates its input like a registration', () => {
    const input = (email: unknown, password: unknown) =>
      bootstrapInput.safeParse({
        BOOTSTRAP_SUPER_ADMIN_EMAIL: email,
        BOOTSTRAP_SUPER_ADMIN_PASSWORD: password,
      }).success;
    expect(input(' Admin@Example.com ', PASSWORD)).toBe(true);
    expect(input(undefined, PASSWORD)).toBe(false);
    expect(input('admin@example.com', undefined)).toBe(false);
    expect(input('admin@example.com', 'short')).toBe(false);
    expect(input('admin@example.com', 'ADMIN@example.com')).toBe(false);
  });
});
