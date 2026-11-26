import { Metadata, status } from '@grpc/grpc-js';
import type { AccountContext } from '@wayfare/nest-common';
import { describe, expect, it, vi } from 'vitest';
import type { IdentityServiceGrpcClient } from './identity-service-grpc.client';
import { IdentityService } from './identity.service';

const grpcError = (errorCode?: string) => {
  const metadata = new Metadata();
  if (errorCode !== undefined) metadata.set('wf-error-code', errorCode);
  return Object.assign(new Error('grpc'), { code: status.NOT_FOUND, details: 'x', metadata });
};
const service = (auth: () => Promise<unknown>, owner: () => Promise<unknown> = auth) =>
  new IdentityService({
    auth: { call: vi.fn(auth) },
    owner: { call: vi.fn(owner) },
  } as unknown as IdentityServiceGrpcClient);
const context = {} as AccountContext;

describe('the token cutoff', () => {
  it('is the cutoff identity holds, or zero when it holds none', async () => {
    expect(
      await service(() => Promise.resolve({ tokensValidAfterMs: '1700' })).getCutoff('u1'),
    ).toBe(1700);
    expect(await service(() => Promise.resolve({})).getCutoff('u1')).toBe(0);
  });

  it('is not-found for an account identity doesn’t know; any other failure stands', async () => {
    expect(
      await service(() => Promise.reject(grpcError('RESOURCE_NOT_FOUND'))).getCutoff('u1'),
    ).toBe('not-found');
    await expect(service(() => Promise.reject(grpcError())).getCutoff('u1')).rejects.toThrow(
      'grpc',
    );
    await expect(service(() => Promise.reject(new Error('down'))).getCutoff('u1')).rejects.toThrow(
      'down',
    );
  });
});

describe('a Venue owner’s contact', () => {
  it('none without an owner, an erased owner, or identity not answering', async () => {
    const answer = (value: unknown) => service(() => Promise.resolve(value));
    expect(await answer({ email: 'x' }).ownerContact(context, null)).toBeNull();
    expect(await answer({}).ownerContact(context, 'u1')).toBeNull();
    expect(
      await service(() => Promise.reject(new Error('down'))).ownerContact(context, 'u1'),
    ).toBeNull();
  });

  it('the email, and the name only when identity has one', async () => {
    const answer = (value: unknown) => service(() => Promise.resolve(value));
    expect(await answer({ email: 'ha@wayfare.test' }).ownerContact(context, 'u1')).toEqual({
      name: null,
      email: 'ha@wayfare.test',
    });
    expect(
      await answer({ email: 'ha@wayfare.test', fullName: 'Hà' }).ownerContact(context, 'u1'),
    ).toEqual({ name: 'Hà', email: 'ha@wayfare.test' });
  });
});
