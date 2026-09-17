import { identityGrpc } from '@wayfare/contracts/grpc';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import { claimsOf, CLIENT, errorCodeOf, registerAccount, registerDevice } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const services = identityServices(prisma);
const { devices, users } = services;

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

describe('device lifecycle', () => {
  it('registers with a device token and records the privacy policy acceptance', async () => {
    const device = await registerDevice(services);
    expect(claimsOf(device.accessToken)).toMatchObject({ typ: 'device', sub: device.deviceId });
    expect(device.expiresIn).toBe(900);
    const [acceptance] = await prisma.legalAcceptance.findMany();
    expect(acceptance).toMatchObject({
      deviceId: device.deviceId,
      userId: null,
      document: 'PRIVACY_POLICY',
    });
  });

  it('exchanges a secret, and bumps last_seen_at at most once an hour', async () => {
    const device = await registerDevice(services);
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await prisma.device.update({ where: { id: device.deviceId }, data: { lastSeenAt: stale } });
    const exchange = () =>
      devices.exchangeDeviceToken({ deviceId: device.deviceId, deviceSecret: device.deviceSecret });
    const [first] = await Promise.all([exchange(), exchange()]);
    expect(claimsOf(first.accessToken).sub).toBe(device.deviceId);
    const bumped = (await prisma.device.findUniqueOrThrow({ where: { id: device.deviceId } }))
      .lastSeenAt;
    expect(bumped.getTime()).toBeGreaterThan(stale.getTime());
    await exchange();
    expect(
      (await prisma.device.findUniqueOrThrow({ where: { id: device.deviceId } })).lastSeenAt,
    ).toEqual(bumped);
  });

  it('refuses a wrong secret, or a secret presented for another device id', async () => {
    const device = await registerDevice(services);
    const other = await registerDevice(services);
    expect(
      await errorCodeOf(
        devices.exchangeDeviceToken({ deviceId: device.deviceId, deviceSecret: 'nope' }),
      ),
    ).toBe('UNAUTHENTICATED');
    expect(
      await errorCodeOf(
        devices.exchangeDeviceToken({
          deviceId: other.deviceId,
          deviceSecret: device.deviceSecret,
        }),
      ),
    ).toBe('UNAUTHENTICATED');
  });

  it('moves a push token to the device that registers it', async () => {
    const first = await registerDevice(services);
    const second = await registerDevice(services);
    await devices.updateDevice({ pushToken: 'ExponentPushToken[abc]' }, first.context);
    const { device } = await devices.updateDevice(
      { pushToken: 'ExponentPushToken[abc]', appVersion: '1.1.0' },
      second.context,
    );
    expect(device).toMatchObject({
      deviceId: second.deviceId,
      appVersion: '1.1.0',
      contentLocale: 'en',
    });
    expect(device).not.toHaveProperty('pushToken');
    const rows = await prisma.device.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((row) => row.pushToken)).toEqual([null, 'ExponentPushToken[abc]']);
  });

  it('forgets a device: revokes its sessions, publishes, and refuses it afterwards', async () => {
    const device = await registerDevice(services);
    const { session } = await registerAccount(services, {
      client: CLIENT.mobile,
      context: device.context,
    });
    await devices.forgetDevice(device.context);
    await devices.forgetDevice(device.context); // a second call changes nothing

    expect(await prisma.session.findFirstOrThrow()).toMatchObject({ revokedReason: 'LOGOUT' });
    const subjects = (await prisma.outboxEvent.findMany()).map((event) => event.subject);
    expect(subjects.filter((subject) => subject === 'identity.device.forgotten')).toHaveLength(1);
    expect(subjects.filter((subject) => subject === 'identity.session.revoked')).toHaveLength(1);
    expect((await prisma.user.findFirstOrThrow()).deletedAt).toBeNull(); // the account is untouched

    expect(
      await errorCodeOf(
        devices.exchangeDeviceToken({
          deviceId: device.deviceId,
          deviceSecret: device.deviceSecret,
        }),
      ),
    ).toBe('DEVICE_REVOKED');
    expect(await errorCodeOf(devices.updateDevice({ appVersion: '2.0.0' }, device.context))).toBe(
      'DEVICE_REVOKED',
    );
    expect(
      await errorCodeOf(
        users.recordLegalAcceptance(
          {
            party: identityGrpc.LegalParty.LEGAL_PARTY_DEVICE,
            document: identityGrpc.LegalDocument.LEGAL_DOCUMENT_PRIVACY_POLICY,
            version: '2026-09-01',
          },
          device.context,
        ),
      ),
    ).toBe('DEVICE_REVOKED');
    expect(session.refreshToken).toBeTruthy();
  });
});
