import { PlaceInactiveReason as Reason, PlaceStatus as S } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { placeStatusNotification } from './place-status-notification';

const PLACE = '01990000-0000-7000-8000-000000000001';
const OWNER = '01990000-0000-7000-8000-000000000002';
const event = (over: Partial<Parameters<typeof placeStatusNotification>[0]>) =>
  ({
    eventId: '01990000-0000-7000-8000-000000000003',
    occurredAt: '2026-09-18T00:00:00.000Z',
    placeId: PLACE,
    from: S.PROCESSING,
    to: S.ACTIVE,
    reason: null,
    deleted: false,
    ownerUserId: OWNER,
    firstPublication: false,
    ...over,
  }) as Parameters<typeof placeStatusNotification>[0];

describe('placeStatusNotification', () => {
  it.each([
    ['a first publication', { firstPublication: true }, 'PLACE_ACTIVATED'],
    ['a return from INACTIVE', { from: S.INACTIVE }, 'PLACE_ACTIVATED'],
    ['a return to ACTIVE after an edit', {}, null],
    [
      'an admin deactivation',
      { from: S.ACTIVE, to: S.INACTIVE, reason: Reason.ADMIN },
      'PLACE_UNPUBLISHED',
    ],
    [
      'the plan limit',
      { from: S.ACTIVE, to: S.INACTIVE, reason: Reason.ENTITLEMENT_LIMIT },
      'PLACE_UNPUBLISHED',
    ],
    [
      "the owner's own deactivation",
      { from: S.ACTIVE, to: S.INACTIVE, reason: Reason.OWNER },
      null,
    ],
    ['an edit sending it to PROCESSING', { from: S.ACTIVE, to: S.PROCESSING }, null],
    ['a deletion with no status change', { from: S.ACTIVE, to: S.ACTIVE, deleted: true }, null],
    ['an Editorial Place', { firstPublication: true, ownerUserId: undefined }, null],
  ] as const)('%s', (_name, over, type) => {
    expect(placeStatusNotification(event(over))?.type ?? null).toBe(type);
  });

  it('carries the reason of an unpublication', () => {
    expect(
      placeStatusNotification(event({ from: S.ACTIVE, to: S.INACTIVE, reason: Reason.ADMIN })),
    ).toEqual({
      type: 'PLACE_UNPUBLISHED',
      data: { placeId: PLACE, reason: 'ADMIN' },
    });
  });
});
