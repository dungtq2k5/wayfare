import { BILLING_ENTITLEMENTS_CHANGED, FREE_PLAN_GRANTS, newId } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { EntitlementsChangedConsumer } from './entitlements-changed.consumer';

describe('EntitlementsChangedConsumer', () => {
  it('sends the owner the new grants on their room', async () => {
    const sent: unknown[] = [];
    const consumer = new EntitlementsChangedConsumer({
      toRoom: (room, event, payload) => {
        sent.push({ room, event, payload });
      },
    });
    const ownerUserId = newId();
    await consumer.handle(
      BILLING_ENTITLEMENTS_CHANGED.schema.parse({
        eventId: newId(),
        occurredAt: new Date().toISOString(),
        ownerUserId,
        entitlementsVersion: 3,
        entitlements: FREE_PLAN_GRANTS,
        previous: null,
      }),
    );
    expect(sent).toEqual([
      {
        room: `owner:${ownerUserId}`,
        event: 'ownerEntitlements',
        payload: { entitlementsVersion: 3, entitlements: FREE_PLAN_GRANTS },
      },
    ]);
    expect(consumer.durable).toBe('billing-billing-entitlements-changed');
  });
});
