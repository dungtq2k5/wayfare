import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { newId } from '@wayfare/contracts';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { toPageMetaOrThrow } from '../grpc/page-meta';
import { buildDeviceContext } from '../testing/contexts';
import { decodeCursor, encodeCursor } from './cursor';
import { Paged, WithMeta } from './paged';
import { Ctx, setAuthState } from './request-context';
import { requestOf } from './request-of';

describe('requestOf and @Ctx', () => {
  const request = {} as Request;
  const context = buildDeviceContext();
  setAuthState(request, { context, authError: null });

  const http = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const ws = {
    getType: () => 'ws',
    switchToWs: () => ({ getClient: () => ({ request }) }),
  } as unknown as ExecutionContext;

  it('reaches the same request over http and ws', () => {
    expect(requestOf(http)).toBe(request);
    expect(requestOf(ws)).toBe(request);
  });

  it('@Ctx() resolves the context over a WebSocket execution context', () => {
    class Gateway {
      handle(@Ctx() _context: unknown) {}
    }
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Gateway, 'handle') as Record<
      string,
      { factory: (data: unknown, host: ExecutionContext) => unknown }
    >;
    const [definition] = Object.values(args);
    expect(definition!.factory(undefined, ws)).toBe(context);
  });
});

describe('WithMeta and Paged', () => {
  it('carries data and meta; a page is a WithMeta', () => {
    const composed = WithMeta.of({ id: 1 }, { degraded: ['billing'] });
    expect(composed).toMatchObject({ data: { id: 1 }, meta: { degraded: ['billing'] } });
    const page = Paged.cursor([1, 2], 'next');
    expect(page).toBeInstanceOf(WithMeta);
    expect(page.items).toBe(page.data);
    expect(page.withItems(['a']).meta).toEqual({ nextCursor: 'next' });
  });
});

describe('cursors', () => {
  it('round-trips an id, opaquely', () => {
    const id = newId();
    const cursor = encodeCursor({ id });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual({ id });
  });

  it.each([
    'not base64!',
    Buffer.from('not json').toString('base64url'),
    Buffer.from(JSON.stringify({ id: '0d5f2c1e-8b2a-4f3e-9c1d-2a3b4c5d6e7f' })).toString(
      'base64url',
    ),
    Buffer.from('null').toString('base64url'),
  ])('refuses %s', (value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});

describe('toPageMetaOrThrow', () => {
  it('passes a meta through and refuses a missing one', () => {
    expect(toPageMetaOrThrow({ page: 1, pageSize: 20, total: 3 })).toEqual({
      page: 1,
      pageSize: 20,
      total: 3,
    });
    expect(() => toPageMetaOrThrow(undefined)).toThrow(/without its meta/);
  });
});
