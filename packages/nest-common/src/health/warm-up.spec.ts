import { describe, expect, it } from 'vitest';
import { unpackCallerContext } from '../grpc/caller-context';
import { WARM_UP_ID, warmUp, warmUpAccount, warmUpDevice } from './warm-up';

describe('warmUp', () => {
  it('runs every step in order, and a step that fails stops neither the others nor the boot', async () => {
    const ran: string[] = [];
    await expect(
      warmUp([
        { name: 'a', run: () => Promise.resolve(ran.push('a')) },
        { name: 'b', run: () => Promise.reject(new Error('RESOURCE_NOT_FOUND')) },
        { name: 'c', run: () => Promise.resolve(ran.push('c')) },
      ]),
    ).resolves.toBeUndefined();
    expect(ran).toEqual(['a', 'c']);
  });

  it('packs callers the services unpack, as the gateway would', () => {
    expect(unpackCallerContext(warmUpDevice())).toMatchObject({
      kind: 'device',
      deviceId: WARM_UP_ID,
    });
    expect(unpackCallerContext(warmUpAccount([], WARM_UP_ID))).toMatchObject({
      kind: 'account',
      userId: WARM_UP_ID,
      ownerVerified: true,
    });
  });
});
