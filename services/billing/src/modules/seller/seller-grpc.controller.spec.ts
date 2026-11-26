// A gRPC controller does one thing (conventions §8): unpack the caller from the call's metadata
// and hand it, with the request, to the use case.
import { packCallerContext } from '@wayfare/nest-common';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import { describe, expect, it, vi } from 'vitest';
import { SellerGrpcController } from './seller-grpc.controller';

/** [rpc, the use case's method, what it is handed]. */
const RPCS: [string, string, 'request'][] = [
  ['getLiveObligations', 'getLiveObligations', 'request'],
  ['countLiveVouchers', 'countLiveVouchers', 'request'],
  ['getErasureBlockers', 'getErasureBlockers', 'request'],
];

describe('SellerGrpcController', () => {
  it.each(RPCS)('%s hands %s its %s', async (rpc, method, shape) => {
    const calls: Record<string, unknown[]> = {};
    // A use case that answers every call with its own name, recording what it was given.
    const use = new Proxy(
      {},
      {
        get: (_target, name: string) =>
          vi.fn((...args: unknown[]) => {
            calls[name] = args;
            return Promise.resolve({ answer: name });
          }),
      },
    );
    const controller = new SellerGrpcController(use as never) as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    const metadata = packCallerContext(buildAccountContext());
    const request = { marker: rpc };
    await expect(controller[rpc]!(request, metadata)).resolves.toEqual({ answer: method });
    const expected = { request: [request] };
    expect(calls[method]).toEqual(expected[shape]);
  });
});
