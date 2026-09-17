import { newId } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';

const prisma = testPrisma();

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

/** The constraint a raw statement violated, from the driver error. */
async function violated(run: () => PromiseLike<unknown>): Promise<string> {
  const error = await Promise.resolve(run()).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, 'the statement should have been refused').not.toBeNull();
  return JSON.stringify(error, Object.getOwnPropertyNames(error));
}

async function insertUser(id = newId()): Promise<string> {
  await prisma.$executeRaw`INSERT INTO users (id, email) VALUES (${id}::uuid, ${`${id}@example.com`})`;
  return id;
}

describe('identity schema objects (rdm-spec §5)', () => {
  it('users_email_lower_ck refuses an address that is not lower-case', async () => {
    const message = await violated(
      () =>
        prisma.$executeRaw`INSERT INTO users (id, email) VALUES (${newId()}::uuid, 'Ann@Example.com')`,
    );
    expect(message).toContain('users_email_lower_ck');
  });

  it('users_erased_implies_deleted_ck refuses erasure without deactivation', async () => {
    const id = await insertUser();
    const message = await violated(
      () => prisma.$executeRaw`UPDATE users SET erased_at = now() WHERE id = ${id}::uuid`,
    );
    expect(message).toContain('users_erased_implies_deleted_ck');
  });

  it('users_locked_until_ck refuses an expiry without a lock', async () => {
    const id = await insertUser();
    const message = await violated(
      () => prisma.$executeRaw`UPDATE users SET locked_until = now() WHERE id = ${id}::uuid`,
    );
    expect(message).toContain('users_locked_until_ck');
  });

  it('legal_acceptances_party_ck refuses an acceptance by nobody', async () => {
    const message = await violated(
      () => prisma.$executeRaw`
        INSERT INTO legal_acceptances (id, document, version)
        VALUES (${newId()}::uuid, 'PRIVACY_POLICY', '2026-09-01')`,
    );
    expect(message).toContain('legal_acceptances_party_ck');
  });

  it('sessions_client_ck refuses an unknown client', async () => {
    const userId = await insertUser();
    const message = await violated(
      () => prisma.$executeRaw`
        INSERT INTO sessions (id, user_id, family_id, refresh_token_hash, client, expires_at)
        VALUES (${newId()}::uuid, ${userId}::uuid, ${newId()}::uuid, ${'c'.repeat(64)}, 'TV', now())`,
    );
    expect(message).toContain('sessions_client_ck');
  });
});
