import {
  AnalyticsLevel,
  ERROR_CODE_METADATA_KEY,
  NarrationLanguageScope,
} from '@wayfare/contracts';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { describe, expect, it, vi } from 'vitest';
import { BillingPortService } from './billing-port.service';
import type { BillingServiceGrpcClient } from './billing-service-grpc.client';
import { toEntitlements } from './entitlement.mapper';

/** The error code a failed call carries in its metadata. */
async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (e: unknown) => e,
  );
  return (error as { getError(): { metadata: { get(key: string): unknown[] } } })
    .getError()
    .metadata.get(ERROR_CODE_METADATA_KEY)[0];
}

const grants: billingGrpc.Entitlements = {
  maxPlaces: 3,
  autoNarration: true,
  narrationLanguageScope: billingGrpc.NarrationLanguageScope.NARRATION_LANGUAGE_SCOPE_LAUNCH,
  maxPhotosPerPlace: 8,
  maxMenuItemsPerPlace: 200,
  discoveryBoostSlots: 1,
  aiCreditsPerDay: 10,
  analyticsLevel: billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_BASIC,
  canSellVouchers: true,
  voucherCommissionBps: 1500,
};

function port(answers: { seller?: () => Promise<unknown>; entitlements?: () => Promise<unknown> }) {
  const billing = {
    seller: { call: vi.fn(answers.seller ?? (() => Promise.reject(new Error('down')))) },
    entitlements: {
      call: vi.fn(answers.entitlements ?? (() => Promise.reject(new Error('down')))),
    },
  };
  return {
    service: new BillingPortService(billing as unknown as BillingServiceGrpcClient),
    billing,
  };
}

describe('billing, as catalog asks it (api-endpoints-plan §12.2)', () => {
  it('counts a Place’s unredeemed vouchers', async () => {
    const { service, billing } = port({ seller: () => Promise.resolve({ count: 2 }) });
    expect(await service.countLiveVouchers('p1')).toBe(2);
    expect(billing.seller.call).toHaveBeenCalledWith(
      'countLiveVouchers',
      { placeId: 'p1' },
      expect.objectContaining({ kind: 'anonymous' }),
    );
  });

  it('refuses, never guesses, when billing can’t count the vouchers', async () => {
    const { service } = port({});
    expect(await codeOf(service.countLiveVouchers('p1'))).toBe('UPSTREAM_UNAVAILABLE');
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a transport rejecting with no Error, the case the port's fallback guards
    const odd = port({ seller: () => Promise.reject('not an error') }).service;
    expect(await codeOf(odd.countLiveVouchers('p1'))).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('reads an owner’s grants and their version at the moment of deciding', async () => {
    const { service } = port({
      entitlements: () => Promise.resolve({ entitlements: grants, entitlementsVersion: '7' }),
    });
    expect(await service.getEntitlements('o1')).toMatchObject({
      maxPlaces: 3,
      narrationLanguageScope: NarrationLanguageScope.LAUNCH,
      analyticsLevel: AnalyticsLevel.BASIC,
      voucherCommissionBps: 1500,
    });
    expect(await service.getEntitlementsVersion('o1')).toBe(7);
  });

  it('fails closed when billing can’t say what an owner may do', async () => {
    const { service } = port({});
    expect(await codeOf(service.getEntitlements('o1'))).toBe('ENTITLEMENTS_UNAVAILABLE');
    expect(await codeOf(service.getEntitlementsVersion('o1'))).toBe('ENTITLEMENTS_UNAVAILABLE');
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a transport rejecting with no Error, the case the port's fallback guards
    const odd = port({ entitlements: () => Promise.reject('not an error') }).service;
    expect(await codeOf(odd.getEntitlements('o1'))).toBe('ENTITLEMENTS_UNAVAILABLE');
    expect(await codeOf(odd.getEntitlementsVersion('o1'))).toBe('ENTITLEMENTS_UNAVAILABLE');
  });
});

describe('billing’s grant set, read', () => {
  it('reads an absent commission as none', () => {
    const { voucherCommissionBps: _omitted, ...without } = grants;
    expect(toEntitlements(without).voucherCommissionBps).toBeNull();
  });

  it('refuses no grants, or an enum this build can’t read: billing’s fault, never the owner’s', () => {
    expect(() => toEntitlements(undefined)).toThrow('billing sent no grants');
    expect(() =>
      toEntitlements({
        ...grants,
        narrationLanguageScope:
          billingGrpc.NarrationLanguageScope.NARRATION_LANGUAGE_SCOPE_UNSPECIFIED,
      }),
    ).toThrow('billing sent an unknown narration scope');
    expect(() =>
      toEntitlements({
        ...grants,
        analyticsLevel: billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_UNSPECIFIED,
      }),
    ).toThrow('billing sent an unknown analytics level');
  });
});
