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

  it('owner_registrations_one_pending refuses a second open application', async () => {
    const userId = await insertUser();
    const insert = (status: string) => prisma.$executeRaw`
      INSERT INTO owner_registrations
        (id, user_id, status, business_name, business_address, contact_name, contact_phone)
      VALUES (${newId()}::uuid, ${userId}::uuid, ${status}, 'Quán', 'Q1', 'An', '+84901234567')`;
    await insert('PENDING');
    await insert('WITHDRAWN');
    expect(await violated(() => insert('PENDING'))).toContain('owner_registrations_one_pending');
  });

  it('owner_registrations_reviewed_ck ties a review time to a decision', async () => {
    const userId = await insertUser();
    const insert = (status: string, reviewedAt: Date | null) => prisma.$executeRaw`
      INSERT INTO owner_registrations
        (id, user_id, status, business_name, business_address, contact_name, contact_phone,
         reviewed_at)
      VALUES (${newId()}::uuid, ${userId}::uuid, ${status}, 'Quán', 'Q1', 'An', '+84901234567',
              ${reviewedAt})`;
    expect(await violated(() => insert('APPROVED', null))).toContain(
      'owner_registrations_reviewed_ck',
    );
    expect(await violated(() => insert('WITHDRAWN', new Date()))).toContain(
      'owner_registrations_reviewed_ck',
    );
    await insert('REJECTED', new Date());
  });

  it('account_recoveries_one_live refuses a second live case for one owner', async () => {
    const userId = await insertUser();
    const staffId = await insertUser();
    const insert = (status: string) => prisma.$executeRaw`
      INSERT INTO account_recoveries
        (id, user_id, status, requested_email, evidence_codes, support_reference, opened_by_id,
         expires_at)
      VALUES (${newId()}::uuid, ${userId}::uuid, ${status}, ${`new${newId()}@example.com`},
              ARRAY['PHONE_CALLBACK', 'BILLING_KNOWLEDGE']::varchar[], 'TICKET-1',
              ${staffId}::uuid, now() + interval '14 days')`;
    await insert('PENDING_APPROVAL');
    // A case that ended leaves the way clear for the next one.
    await insert('CANCELLED');
    expect(await violated(() => insert('ON_HOLD'))).toContain('account_recoveries_one_live');
  });

  it('account_recoveries_evidence_ck wants two checks, one of them the phone callback', async () => {
    const userId = await insertUser();
    const staffId = await insertUser();
    const insert = (codes: string[]) => prisma.$executeRaw`
      INSERT INTO account_recoveries
        (id, user_id, status, requested_email, evidence_codes, support_reference, opened_by_id,
         expires_at)
      VALUES (${newId()}::uuid, ${userId}::uuid, 'CANCELLED', ${`new${newId()}@example.com`},
              ${codes}::varchar[], 'TICKET-1', ${staffId}::uuid, now() + interval '14 days')`;
    expect(await violated(() => insert(['PHONE_CALLBACK']))).toContain(
      'account_recoveries_evidence_ck',
    );
    expect(await violated(() => insert(['BUSINESS_DETAILS_MATCH', 'BILLING_KNOWLEDGE']))).toContain(
      'account_recoveries_evidence_ck',
    );
    await insert(['PHONE_CALLBACK', 'BILLING_KNOWLEDGE']);
  });

  it('account_recoveries_four_eyes_ck refuses an approver who opened the case', async () => {
    const userId = await insertUser();
    const staffId = await insertUser();
    const insert = (approverId: string) => prisma.$executeRaw`
      INSERT INTO account_recoveries
        (id, user_id, status, requested_email, evidence_codes, support_reference, opened_by_id,
         approved_by_id, expires_at)
      VALUES (${newId()}::uuid, ${userId}::uuid, 'ON_HOLD', ${`new${newId()}@example.com`},
              ARRAY['PHONE_CALLBACK', 'BILLING_KNOWLEDGE']::varchar[], 'TICKET-1',
              ${staffId}::uuid, ${approverId}::uuid, now() + interval '14 days')`;
    expect(await violated(() => insert(staffId))).toContain('account_recoveries_four_eyes_ck');
    await insert(await insertUser());
  });
});
