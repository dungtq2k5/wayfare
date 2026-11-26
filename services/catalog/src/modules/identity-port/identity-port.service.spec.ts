import { ERROR_CODE_METADATA_KEY } from '@wayfare/contracts';
import { describe, expect, it, vi } from 'vitest';
import { IdentityPortService } from './identity-port.service';
import type { IdentityServiceGrpcClient } from './identity-service-grpc.client';

function port(answer: () => Promise<unknown>) {
  const identity = { owners: { call: vi.fn(answer) } };
  return {
    service: new IdentityPortService(identity as unknown as IdentityServiceGrpcClient),
    identity,
  };
}

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

describe('identity, as catalog asks it (api-endpoints-plan §12.2)', () => {
  it('says whether an owner is still verified and live', async () => {
    const { service, identity } = port(() =>
      Promise.resolve({ verified: true, live: false, other: 'ignored' }),
    );
    expect(await service.getOwnerVerification('u1')).toEqual({ verified: true, live: false });
    expect(identity.owners.call).toHaveBeenCalledWith(
      'getOwnerVerification',
      { userId: 'u1' },
      expect.objectContaining({ kind: 'anonymous' }),
    );
  });

  it('fails closed when identity can’t say: an approval is refused, not written unchecked', async () => {
    expect(
      await codeOf(
        port(() => Promise.reject(new Error('down'))).service.getOwnerVerification('u1'),
      ),
    ).toBe('UPSTREAM_UNAVAILABLE');
    expect(
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a transport rejecting with no Error, the case the port's fallback guards
      await codeOf(port(() => Promise.reject('not an error')).service.getOwnerVerification('u1')),
    ).toBe('UPSTREAM_UNAVAILABLE');
  });
});
