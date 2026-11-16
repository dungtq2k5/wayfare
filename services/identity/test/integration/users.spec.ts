import { identityGrpc } from '@wayfare/contracts/grpc';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import { errorCodeOf, registerAccount, registerDevice } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const services = identityServices(prisma);
const { users } = services;

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

async function account(deviceId: string | null = null) {
  const { session } = await registerAccount(services);
  return buildAccountContext({ userId: session.user!.id, deviceId });
}

describe('own account', () => {
  it('reads roles and permissions from the database', async () => {
    const context = await account();
    const me = await users.getMe(context);
    expect(me).toMatchObject({ roles: ['USER'], permissions: [], ownerVerified: false });
    expect(me.user?.id).toBe(context.userId);
    const admin = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    await prisma.userRole.create({ data: { userId: context.userId, roleId: admin.id } });
    expect((await users.getMe(context)).roles).toEqual(['ADMIN', 'USER']);
  });

  it('refuses a deactivated account', async () => {
    const context = await account();
    await prisma.user.updateMany({ data: { deletedAt: new Date() } });
    expect(await errorCodeOf(users.getMe(context))).toBe('UNAUTHENTICATED');
  });

  it('updates the name and language only, defaulting nothing', async () => {
    const context = await account();
    const { user } = await users.updateMe({ fullName: '  Ann   Lee ' }, context);
    expect(user).toMatchObject({ fullName: 'Ann Lee', preferredLocale: 'en' });
    const { user: again } = await users.updateMe({ preferredLocale: 'ja-JP' }, context);
    expect(again).toMatchObject({ fullName: 'Ann Lee', preferredLocale: 'ja' });
    expect(await errorCodeOf(users.updateMe({ preferredLocale: 'xx' }, context))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('lists the newest acceptance per party and document, marking what is current', async () => {
    const device = await registerDevice(services);
    const context = await account(device.deviceId);
    await prisma.legalAcceptance.create({
      data: {
        userId: context.userId,
        document: 'OWNER_AGREEMENT',
        version: '2025-01-01',
        acceptedAt: new Date(0),
      },
    });
    const { acceptances } = await users.listLegalAcceptances(context);
    const summary = acceptances
      .map((entry) => [entry.party, entry.document, entry.current])
      .sort((a, b) => String(a).localeCompare(String(b)));
    expect(summary).toEqual(
      [
        [
          identityGrpc.LegalParty.LEGAL_PARTY_DEVICE,
          identityGrpc.LegalDocument.LEGAL_DOCUMENT_PRIVACY_POLICY,
          true,
        ],
        [
          identityGrpc.LegalParty.LEGAL_PARTY_USER,
          identityGrpc.LegalDocument.LEGAL_DOCUMENT_TERMS_OF_SERVICE,
          true,
        ],
        [
          identityGrpc.LegalParty.LEGAL_PARTY_USER,
          identityGrpc.LegalDocument.LEGAL_DOCUMENT_OWNER_AGREEMENT,
          false,
        ],
      ].sort((a, b) => String(a).localeCompare(String(b))),
    );
  });

  it('records a current acceptance and refuses an outdated one', async () => {
    const context = await account();
    const request = {
      party: identityGrpc.LegalParty.LEGAL_PARTY_USER,
      document: identityGrpc.LegalDocument.LEGAL_DOCUMENT_OWNER_AGREEMENT,
      version: '2026-09-01',
    };
    const { acceptance } = await users.recordLegalAcceptance(request, context);
    expect(acceptance).toMatchObject({ version: '2026-09-01', current: true });
    expect(
      await errorCodeOf(
        users.recordLegalAcceptance({ ...request, version: '2025-01-01' }, context),
      ),
    ).toBe('LEGAL_VERSION_OUTDATED');
    const unspecified = {
      ...request,
      document: identityGrpc.LegalDocument.LEGAL_DOCUMENT_UNSPECIFIED,
    };
    expect(await errorCodeOf(users.recordLegalAcceptance(unspecified, context))).toBe(
      'VALIDATION_FAILED',
    );
  });
});
