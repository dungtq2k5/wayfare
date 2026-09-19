// The Vĩnh Khánh owners seed (ADR 0002): owners and an applicant through identity's own services,
// the seed editor reviewing; a second run writes nothing.
import { IDENTITY_OWNER_VERIFIED, OwnerRegistrationStatus } from '@wayfare/contracts';
import { SEED_EDITOR_USER_ID } from '@wayfare/contracts/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertNotProduction,
  loadPilotOwners,
  seedPilotD4Owners,
} from '../../prisma/seed/pilot-d4-owners.seed';
import { testPrisma, truncateAll } from '../setup/database';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof identityServices>;
const all = loadPilotOwners();
// A slice: one approved owner and the pending applicant.
const slice = [
  all.find((owner) => owner.slug === 'owner-1')!,
  all.find((o) => o.slug === 'applicant-5')!,
];

beforeEach(async () => {
  await truncateAll(prisma);
  services = identityServices(prisma);
  await prisma.user.create({
    data: { id: SEED_EDITOR_USER_ID, email: 'seed@wayfare.test', isEmailVerified: true },
  });
});
afterAll(() => prisma.$disconnect());

const seed = (password: string | null) =>
  seedPilotD4Owners(
    {
      prisma,
      registrations: services.registrations,
      review: services.ownerReview,
      legal: services.legal,
      access: services.access,
    },
    slice,
    { password },
  );

describe('the Vĩnh Khánh owners seed', () => {
  it('creates, applies and approves through the services; a second run writes nothing', async () => {
    const first = await seed('correct horse battery');
    expect(first).toEqual(
      expect.arrayContaining([
        'created owner-1@wayfare.test',
        "approved owner-1's application",
        "submitted applicant-5's application",
      ]),
    );
    const [owner, applicant] = slice;
    expect(
      await prisma.ownerRegistration.findUniqueOrThrow({ where: { id: owner!.registration.id } }),
    ).toMatchObject({
      status: OwnerRegistrationStatus.APPROVED,
      reviewedById: SEED_EDITOR_USER_ID,
    });
    expect(
      (
        await prisma.ownerRegistration.findUniqueOrThrow({
          where: { id: applicant!.registration.id },
        })
      ).status,
    ).toBe(OwnerRegistrationStatus.PENDING);
    const verified = await prisma.outboxEvent.findMany({
      where: { subject: IDENTITY_OWNER_VERIFIED.subject },
    });
    expect(verified.map((row) => (row.payload as { userId: string }).userId)).toEqual([owner!.id]);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner!.id } });
    expect(user.passwordHash).not.toBeNull();
    expect(user.ownerVerifiedAt).not.toBeNull();

    const outboxBefore = await prisma.outboxEvent.count();
    const second = await seed('correct horse battery');
    expect(second.every((line) => line.startsWith('unchanged'))).toBe(true);
    expect(await prisma.outboxEvent.count()).toBe(outboxBefore);
    await services.dispatcher.idle();
  });

  it('creates owners who cannot sign in when no seed password is set', async () => {
    const lines = await seed(null);
    expect(lines[0]).toMatch(/no password/);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: slice[0]!.id } })).passwordHash,
    ).toBeNull();
    await services.dispatcher.idle();
  });

  it('refuses a production environment', () => {
    expect(() => assertNotProduction({ NODE_ENV: 'production' })).toThrow(/NODE_ENV=production/);
    expect(() => assertNotProduction({ NODE_ENV: 'development' })).not.toThrow();
  });
});
