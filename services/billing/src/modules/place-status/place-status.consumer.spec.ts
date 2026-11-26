import { BoostEndedReason, PlaceStatus } from '@wayfare/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaceStatusConsumer } from './place-status.consumer';

const prisma = {
  discoveryBoost: { findFirst: vi.fn() },
  $transaction: vi.fn((run: (tx: unknown) => unknown) => run('tx')),
};
const entitlements = { lockAccount: vi.fn() };
const ledger = { live: vi.fn(), end: vi.fn() };
const consumer = new PlaceStatusConsumer(prisma as never, entitlements as never, ledger as never);
const account = { id: 'acc', ownerUserId: 'u1', discoveryBoostSlots: 2 };

const changed = (overrides: Record<string, unknown>) =>
  ({
    placeId: 'p1',
    to: PlaceStatus.INACTIVE,
    deleted: false,
    reason: 'OWNER_HID',
    ...overrides,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.discoveryBoost.findFirst.mockResolvedValue({ billingAccountId: 'acc' });
  entitlements.lockAccount.mockResolvedValue(account);
  ledger.live.mockResolvedValue([{ placeId: 'p1' }, { placeId: 'p2' }]);
  ledger.end.mockResolvedValue(1);
});

describe('a Venue leaving (rdm-spec B-5)', () => {
  it('starts nothing when a Venue becomes live again', async () => {
    await consumer.handle(changed({ to: PlaceStatus.ACTIVE }));
    expect(prisma.discoveryBoost.findFirst).not.toHaveBeenCalled();
  });

  it('ends only that Venue’s boost, telling the owner why it stopped being live', async () => {
    await consumer.handle(changed({}));
    expect(ledger.end).toHaveBeenCalledWith(
      'tx',
      [{ placeId: 'p1' }],
      BoostEndedReason.PLACE_UNAVAILABLE,
      expect.any(Date),
      {
        ownerUserId: 'u1',
        planName: null,
        slots: 2,
        place: { placeInactiveReason: 'OWNER_HID', deleted: false },
      },
    );
  });

  it('ends a deleted Venue’s boost even when it was live, naming no inactive reason', async () => {
    ledger.end.mockResolvedValue(0);
    await consumer.handle(changed({ to: PlaceStatus.ACTIVE, deleted: true }));
    expect(ledger.end.mock.calls[0]![4]).toMatchObject({
      place: { placeInactiveReason: null, deleted: true },
    });
  });

  it('does nothing for a Venue with no live boost, or an account gone since', async () => {
    prisma.discoveryBoost.findFirst.mockResolvedValueOnce(null);
    await consumer.handle(changed({}));
    entitlements.lockAccount.mockResolvedValueOnce(null);
    await consumer.handle(changed({}));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ledger.end).not.toHaveBeenCalled();
  });
});
