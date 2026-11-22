import { AccountKind, SubscriptionStatus } from '@wayfare/contracts';
import { accountKindProto, subscriptionStatusProto } from '@wayfare/contracts/grpc';
import type { AccountContext } from '@wayfare/nest-common';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it, vi } from 'vitest';
import type { BillingServiceGrpcClient } from '../billing/billing-service-grpc.client';
import type { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import { AdminUsersService } from './admin-users.service';

const ts = toProtoTimestamp(new Date('2026-05-01T00:00:00.000Z'));
const user = {
  id: 'u1',
  email: 'ha@wayfare.test',
  roles: [],
  isLocked: false,
  ownerVerified: true,
  isEmailVerified: true,
  createdAt: ts,
  kind: accountKindProto.toProto(AccountKind.OWNER),
};
const detail = {
  user,
  devicesCount: 0,
  permissionCodes: [],
  passwordSet: true,
  preferredLocale: 'vi',
};
const reader = { permissions: ['billing.account.read'] } as unknown as AccountContext;

function service(identity: Record<string, unknown>, billing: () => Promise<unknown>) {
  const identityCall = vi.fn((method: string, _request?: unknown) =>
    Promise.resolve(identity[method]),
  );
  const billingCall = vi.fn(billing);
  return {
    identityCall,
    billingCall,
    users: new AdminUsersService(
      { adminUsers: { call: identityCall } } as unknown as IdentityServiceGrpcClient,
      { billing: { call: billingCall } } as unknown as BillingServiceGrpcClient,
    ),
  };
}

describe('an admin’s user page', () => {
  it('an erased account is its placeholder, billing never asked', async () => {
    const { users, billingCall } = service(
      { getUser: { erased: { id: 'u9', erasedAt: ts } } },
      () => Promise.resolve({}),
    );
    expect(await users.get(reader, 'u9')).toMatchObject({ erased: true, id: 'u9' });
    expect(billingCall).not.toHaveBeenCalled();
  });

  it('a verified owner, for a reader of accounts: billing’s summary', async () => {
    const { users } = service({ getUser: { user: detail } }, () =>
      Promise.resolve({
        billingAccountId: 'b1',
        planCode: 'GROWTH',
        subscriptionStatus: subscriptionStatusProto.toProto(SubscriptionStatus.ACTIVE),
      }),
    );
    expect(await users.get(reader, 'u1')).toMatchObject({
      billing: { accountId: 'b1', planCode: 'GROWTH', subscriptionStatus: 'ACTIVE' },
    });
  });

  it('billing failing, or answering a status this build doesn’t know: the page degraded', async () => {
    for (const billing of [
      () => Promise.reject(new Error('down')),
      () => Promise.reject(Object.assign(Object.create(null) as Error, { message: 'x' })),
      () => Promise.resolve({ billingAccountId: 'b1', planCode: 'X', subscriptionStatus: 99 }),
    ]) {
      const { users } = service({ getUser: { user: detail } }, billing);
      expect(await users.get(reader, 'u1')).toMatchObject({
        data: { billing: null },
        meta: { degraded: ['billing'] },
      });
    }
  });
});

describe('the user writes and reads', () => {
  it('updates only the name given', async () => {
    const { users, identityCall } = service({ updateUser: { user } }, () => Promise.resolve({}));
    await users.update(reader, 'u1', {});
    await users.update(reader, 'u1', { fullName: 'Hà' });
    expect(identityCall.mock.calls.map((call) => call[1])).toEqual([
      { userId: 'u1' },
      { userId: 'u1', fullName: 'Hà' },
    ]);
  });

  it('lists email deliveries from the cursor given, ending where identity sends none', async () => {
    const { users, identityCall } = service({ listEmailDeliveries: { deliveries: [] } }, () =>
      Promise.resolve({}),
    );
    const page = await users.emailDeliveries(reader, 'u1', { limit: 20, cursor: 'c1' });
    expect(identityCall.mock.calls[0]![1]).toEqual({
      userId: 'u1',
      page: { limit: 20, cursor: 'c1' },
    });
    expect(page).toMatchObject({ meta: { nextCursor: null } });
  });
});
