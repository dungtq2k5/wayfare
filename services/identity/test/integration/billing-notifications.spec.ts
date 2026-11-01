// billing's events reach the owner (api-endpoints-plan §10): a failed payment rings the bell and
// sends PAYMENT_FAILED; a narrowing of grants sends ENTITLEMENTS_REDUCED, which says what was
// lost; a widening or a first grant tells nobody; a redelivery changes nothing.
import {
  AnalyticsLevel,
  BILLING_ENTITLEMENTS_CHANGED,
  EntitlementsChangeCause,
  BILLING_SUBSCRIPTION_PAYMENT_FAILED,
  EmailTemplate,
  FREE_PLAN_GRANTS,
  NarrationLanguageScope,
  newId,
  NotificationType,
} from '@wayfare/contracts';
import type { Entitlements } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EntitlementsChangedConsumer } from '../../src/modules/entitlements-changed/entitlements-changed.consumer';
import { PaymentFailedConsumer } from '../../src/modules/payment-failed/payment-failed.consumer';
import { testPrisma, truncateAll } from '../setup/database';
import { freshEmail } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof identityServices>;
let ownerId: string;

const GROWTH: Entitlements = {
  maxPlaces: 10,
  autoNarration: true,
  narrationLanguageScope: NarrationLanguageScope.LAUNCH,
  maxPhotosPerPlace: 8,
  maxMenuItemsPerPlace: 200,
  discoveryBoostSlots: 1,
  aiCreditsPerDay: 10,
  analyticsLevel: AnalyticsLevel.BASIC,
  canSellVouchers: true,
  voucherCommissionBps: 1500,
};

beforeEach(async () => {
  await truncateAll(prisma);
  services = identityServices(prisma);
  const owner = await prisma.user.create({
    data: { email: freshEmail(), isEmailVerified: true, ownerVerifiedAt: new Date() },
    select: { id: true },
  });
  ownerId = owner.id;
});
afterAll(() => prisma.$disconnect());

const deliveries = () =>
  prisma.emailDelivery.findMany({ where: { recipientUserId: ownerId }, orderBy: { id: 'asc' } });

describe('billing.subscription.payment_failed', () => {
  it('rings the bell and sends PAYMENT_FAILED once per event', async () => {
    const consumer = new PaymentFailedConsumer(
      prisma,
      services.notifications,
      services.email,
      services.dispatcher,
    );
    const payload = BILLING_SUBSCRIPTION_PAYMENT_FAILED.schema.parse({
      eventId: newId(),
      occurredAt: new Date().toISOString(),
      ownerUserId: ownerId,
      attemptCount: 2,
      nextAttemptAt: '2026-09-21T08:00:00.000Z',
    });
    await consumer.handle(payload);
    // A redelivery comes after the first attempt's send, as JetStream redelivers after a failure.
    await services.dispatcher.idle();
    await consumer.handle(payload);
    const rows = await prisma.notification.findMany({ where: { recipientUserId: ownerId } });
    expect(rows).toEqual([
      expect.objectContaining({
        type: NotificationType.SUBSCRIPTION_PAYMENT_FAILED,
        data: { attemptCount: 2, nextAttemptAt: '2026-09-21T08:00:00.000Z' },
        eventId: payload.eventId,
      }),
    ]);
    expect((await deliveries()).map((row) => row.template)).toEqual([EmailTemplate.PAYMENT_FAILED]);
    expect(services.frames.of('notificationNew')).toHaveLength(1);
    await services.dispatcher.idle();
    expect(services.mailbox.sent).toHaveLength(1);
  });
});

describe('billing.entitlements.changed', () => {
  const consumer = () =>
    new EntitlementsChangedConsumer(
      prisma,
      services.notifications,
      services.email,
      services.dispatcher,
    );

  const changed = (
    entitlements: Entitlements,
    previous: Entitlements | null,
    version = 3,
    cause = EntitlementsChangeCause.SUBSCRIPTION,
  ) =>
    BILLING_ENTITLEMENTS_CHANGED.schema.parse({
      eventId: newId(),
      occurredAt: new Date().toISOString(),
      ownerUserId: ownerId,
      entitlementsVersion: version,
      entitlements,
      previous,
      cause,
    });

  it('says what a cancellation took away, with a console link to the plan page', async () => {
    await consumer().handle(changed(FREE_PLAN_GRANTS, GROWTH));
    const [row] = await prisma.notification.findMany({ where: { recipientUserId: ownerId } });
    expect(row).toMatchObject({
      type: NotificationType.ENTITLEMENTS_REDUCED,
      data: {
        entitlementsVersion: 3,
        reduced: [
          'maxPlaces',
          'maxPhotosPerPlace',
          'maxMenuItemsPerPlace',
          'discoveryBoostSlots',
          'aiCreditsPerDay',
        ],
        autoNarrationLost: true,
        vouchersLost: true,
        languagesReduced: true,
        analyticsReduced: true,
      },
    });
    expect((await deliveries()).map((delivery) => delivery.template)).toEqual([
      EmailTemplate.ENTITLEMENTS_REDUCED,
    ]);
    await services.dispatcher.idle();
    expect(services.mailbox.sent[0]!.text).toContain('http://console.localhost/owner/billing');
  });

  it('tells the owner in the bell when a staff override or unpin raises a grant', async () => {
    await consumer().handle(
      changed({ ...GROWTH, maxPlaces: 25 }, GROWTH, 4, EntitlementsChangeCause.OVERRIDE),
    );
    await consumer().handle(changed(GROWTH, FREE_PLAN_GRANTS, 5, EntitlementsChangeCause.UNPIN));
    const rows = await prisma.notification.findMany({
      where: { recipientUserId: ownerId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((row) => [row.type, row.data])).toEqual([
      [NotificationType.ENTITLEMENTS_RAISED, { entitlementsVersion: 4, raised: ['maxPlaces'] }],
      [
        NotificationType.ENTITLEMENTS_RAISED,
        expect.objectContaining({ entitlementsVersion: 5, autoNarrationGained: true }),
      ],
    ]);
    // The bell only: no email template.
    expect(await deliveries()).toEqual([]);
  });

  it('tells nobody of a raise by an applied plan or a purchase', async () => {
    await consumer().handle(changed(GROWTH, FREE_PLAN_GRANTS, 4, EntitlementsChangeCause.PLAN));
    await consumer().handle(
      changed(GROWTH, FREE_PLAN_GRANTS, 5, EntitlementsChangeCause.SUBSCRIPTION),
    );
    expect(await prisma.notification.count()).toBe(0);
  });

  it('inserts both when one override raises one grant and lowers another, once each', async () => {
    const event = changed(
      { ...GROWTH, maxPlaces: 25, maxPhotosPerPlace: 4 },
      GROWTH,
      6,
      EntitlementsChangeCause.OVERRIDE,
    );
    await consumer().handle(event);
    await consumer().handle(event);
    const types = (await prisma.notification.findMany({ where: { recipientUserId: ownerId } })).map(
      (row) => row.type,
    );
    expect(types.toSorted((a, b) => a.localeCompare(b))).toEqual([
      NotificationType.ENTITLEMENTS_RAISED,
      NotificationType.ENTITLEMENTS_REDUCED,
    ]);
  });

  it('tells nobody of a widening or of the first grants', async () => {
    await consumer().handle(changed(GROWTH, FREE_PLAN_GRANTS));
    await consumer().handle(changed(FREE_PLAN_GRANTS, null, 1));
    expect(await prisma.notification.count()).toBe(0);
    expect(await deliveries()).toEqual([]);
  });

  it('tells of a narrower language scope alone', async () => {
    await consumer().handle(
      changed({ ...GROWTH, narrationLanguageScope: NarrationLanguageScope.BASIC }, GROWTH),
    );
    const [row] = await prisma.notification.findMany({ where: { recipientUserId: ownerId } });
    expect(row?.data).toEqual({ entitlementsVersion: 3, reduced: [], languagesReduced: true });
  });
});
