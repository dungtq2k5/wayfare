// identity's development seed (ADR 0002): idempotent, and its seed editor unreachable.
import { compareStrings, SystemRole } from '@wayfare/contracts';
import { SEED_EDITOR_EMAIL, SEED_EDITOR_USER_ID } from '@wayfare/contracts/testing';
import { buildAnonymousContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDevAccounts } from '../../prisma/seed/dev-accounts.seed';
import { testPrisma, truncateAll } from '../setup/database';
import { PASSWORD } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const { passwords, mailbox, dispatcher } = identityServices(prisma);

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

const rolesOf = async (email: string) =>
  (
    await prisma.userRole.findMany({
      where: { user: { email } },
      select: { role: { select: { code: true } } },
    })
  )
    .map((row) => row.role.code)
    .toSorted(compareStrings);

describe('seed:dev (identity)', () => {
  it('creates the deactivated seed editor and the two accounts, then writes nothing', async () => {
    const lines = await seedDevAccounts(prisma, { password: PASSWORD });
    expect(lines.filter((line) => line.startsWith('created'))).toHaveLength(4);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: SEED_EDITOR_USER_ID } }),
    ).toMatchObject({
      email: SEED_EDITOR_EMAIL,
      passwordHash: null,
      isEmailVerified: true,
      fullName: 'Wayfare seed',
    });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: SEED_EDITOR_USER_ID } })).deletedAt,
    ).not.toBeNull();
    expect(await rolesOf(SEED_EDITOR_EMAIL)).toEqual([]);
    // An ADMIN opens a recovery and a SUPER_ADMIN approves it (api-endpoints-plan §1.10).
    expect(await rolesOf('admin@wayfare.test')).toEqual([SystemRole.ADMIN, SystemRole.USER]);
    expect(await rolesOf('moderator@wayfare.test')).toEqual(['CONTENT_MODERATOR', SystemRole.USER]);
    expect(await rolesOf('tourist@wayfare.test')).toEqual([SystemRole.USER]);

    const outbox = await prisma.outboxEvent.count();
    const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
    const again = await seedDevAccounts(prisma, { password: 'another password!' });
    expect(again.every((line) => line.startsWith('unchanged'))).toBe(true);
    expect(await prisma.outboxEvent.count()).toBe(outbox);
    expect(await prisma.user.findMany({ orderBy: { id: 'asc' } })).toEqual(users);
  });

  it('skips the accounts without a password, and still makes the seed editor', async () => {
    const lines = await seedDevAccounts(prisma, { password: null });
    expect(lines).toEqual([
      `created ${SEED_EDITOR_EMAIL} (the seed editor, deactivated)`,
      'skipped admin@wayfare.test (SEED_ACCOUNT_PASSWORD is unset)',
      'skipped moderator@wayfare.test (SEED_ACCOUNT_PASSWORD is unset)',
      'skipped tourist@wayfare.test (SEED_ACCOUNT_PASSWORD is unset)',
    ]);
  });

  it('a password reset for the seed editor mints nothing and sends nothing', async () => {
    await seedDevAccounts(prisma, { password: null });
    mailbox.reset();
    await passwords.requestPasswordReset({ email: SEED_EDITOR_EMAIL }, buildAnonymousContext());
    await dispatcher.idle();
    expect(mailbox.sent).toHaveLength(0);
    expect(await prisma.actionToken.count({ where: { userId: SEED_EDITOR_USER_ID } })).toBe(0);
  });
});
