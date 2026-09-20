import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootGateway } from '../support/app';
import type { E2eApp } from '../support/app';

interface Operation {
  responses: Record<
    string,
    {
      content?: Record<string, { schema: { type?: string; properties?: Record<string, unknown> } }>;
    }
  >;
  security?: Record<string, string[]>[];
}

let gateway: E2eApp;
let document: {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown> };
};

beforeAll(async () => {
  gateway = await bootGateway();
  const res = await request(gateway.app.getHttpServer()).get('/docs-json');
  document = res.body as typeof document;
});

afterAll(() => gateway.app.close());

function operations(): [string, Operation][] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item).map(
      ([method, operation]) =>
        [`${method.toUpperCase()} ${path}`, operation] as [string, Operation],
    ),
  );
}

function codesOf(operation: Operation): string[] {
  return Object.values(operation.responses).flatMap((response) => {
    const error = response.content?.['application/json']?.schema.properties?.error as
      { properties: { code: { enum: string[] } } } | undefined;
    return error?.properties.code.enum ?? [];
  });
}

/** The routes that are not rate-limited — none in this build. */
const UNLIMITED = new Set<string>();

/** The routes that document no security: public ones without the refresh cookie. */
const NO_SECURITY = new Set([
  'POST /api/v1/devices',
  'POST /api/v1/devices/token',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/password/forgot',
  'POST /api/v1/auth/password/reset/validate',
  'POST /api/v1/auth/password/reset',
  'POST /api/v1/auth/email/verify',
  'POST /api/v1/auth/email/change/confirm',
  'POST /api/v1/auth/email/change/revert',
]);
const REFRESH_COOKIE = new Set(['POST /api/v1/auth/refresh', 'POST /api/v1/auth/logout']);
const DEVICE_ROUTES = new Set([
  'PATCH /api/v1/devices/me',
  'DELETE /api/v1/devices/me',
  'POST /api/v1/devices/me/legal-acceptances',
  'GET /api/v1/sync/places',
  'GET /api/v1/places/nearby',
  'GET /api/v1/places/{id}',
  'GET /api/v1/places/by-code/{publicCode}',
  'POST /api/v1/narration/on-demand',
  'GET /api/v1/narration/places/{placeId}/status',
  'GET /api/v1/offline/areas/{areaId}/manifest',
  'GET /api/v1/offline/areas/{areaId}/manifest/diff',
  'GET /api/v1/me/favorites',
  'PUT /api/v1/me/favorites/{placeId}',
  'DELETE /api/v1/me/favorites/{placeId}',
]);

/** Routes with a second documented success: done (200) or pending (202). */
const TWO_SUCCESSES = new Map([['POST /api/v1/narration/on-demand', ['200', '202']]]);

/** Public reads a CDN may hold. */
const PUBLIC_READS = new Set(['GET /api/v1/categories', 'GET /api/v1/areas']);

/** Bodies that are not the JSON envelope, with their media type. */
const NON_JSON = new Map([
  ['GET /api/v1/admin/places/{id}/qr', 'image/svg+xml'],
  ['POST /api/v1/admin/narration/pronunciations/preview', 'audio/mpeg'],
]);

describe('OpenAPI contract', () => {
  it('documents every route of this build, and no probe', () => {
    const names = operations().map(([name]) => name);
    expect(names).toHaveLength(142);
    // Provider webhooks and the QR redirect are not client routes; they stay out of the document.
    expect(names.some((name) => name.includes('/webhooks/'))).toBe(false);
    expect(names.some((name) => name.includes('/q/'))).toBe(false);
    expect(names.some((name) => name.includes('/health'))).toBe(false);
  });

  it.each(['POST /api/v1/devices'])(
    '%s answers 201 with { data: RegisterDeviceResponseDto }',
    (name) => {
      const operation = Object.fromEntries(operations())[name]!;
      expect(operation.responses['201']?.content?.['application/json']?.schema).toEqual({
        type: 'object',
        required: ['data'],
        properties: { data: { $ref: '#/components/schemas/RegisterDeviceResponseDto' } },
      });
      expect(document.components.schemas.RegisterDeviceResponseDto).toBeDefined();
    },
  );

  it('documents the erasable account rows as a union discriminated on `erased`', () => {
    for (const name of ['AdminUserListItemResponseDto', 'AdminUserViewResponseDto']) {
      const schema = document.components.schemas[name] as {
        oneOf: { properties: { erased: { enum: boolean[] } } }[];
      };
      expect(
        schema.oneOf.map((variant) => variant.properties.erased.enum),
        name,
      ).toEqual([[false], [true]]);
    }
    expect(document.components.schemas.AuditActionResponseDto).toEqual({ type: 'string' });
  });

  it('gives every operation exactly one 2xx, with data unless it is a 204 or a 202', () => {
    for (const [name, operation] of operations()) {
      const success = Object.keys(operation.responses).filter((status) => status.startsWith('2'));
      const alternatives = TWO_SUCCESSES.get(name);
      if (alternatives !== undefined) {
        expect(success, name).toEqual(alternatives);
        for (const status of alternatives) {
          expect(
            operation.responses[status]?.content?.['application/json']?.schema.properties,
            `${name} ${status}`,
          ).toHaveProperty('data');
        }
        continue;
      }
      expect(success, name).toHaveLength(1);
      const [status] = success;
      const mediaType = NON_JSON.get(name);
      if (mediaType !== undefined)
        expect(operation.responses[status!]?.content, name).toEqual({
          [mediaType]: { schema: { type: 'string' } },
        });
      else if (status === '204' || status === '202')
        expect(operation.responses[status]?.content, name).toBeUndefined();
      else
        expect(
          operation.responses[status!]?.content?.['application/json']?.schema.properties,
          name,
        ).toHaveProperty('data');
    }
  });

  it('lists INTERNAL everywhere, and RATE_LIMITED exactly on rate-limited routes', () => {
    for (const [name, operation] of operations()) {
      const codes = codesOf(operation);
      expect(codes, name).toContain('INTERNAL');
      expect(codes.includes('RATE_LIMITED'), name).toBe(!UNLIMITED.has(name));
    }
  });

  it("matches each operation's security to its marker", () => {
    for (const [name, operation] of operations()) {
      if (NO_SECURITY.has(name) || PUBLIC_READS.has(name))
        expect(operation.security, name).toBeUndefined();
      else if (REFRESH_COOKIE.has(name))
        expect(operation.security, name).toEqual([{ refreshCookie: [] }]);
      else if (DEVICE_ROUTES.has(name)) {
        expect(operation.security, name).toEqual([
          { deviceBearer: [] },
          { accountBearer: [] },
          { accessCookie: [] },
        ]);
      } else
        expect(operation.security, name).toEqual([{ accountBearer: [] }, { accessCookie: [] }]);
    }
  });

  it('documents the tagged reads with their 304, and a sync page with its own meta', () => {
    for (const name of ['GET /api/v1/sync/places', 'GET /api/v1/places/{id}']) {
      expect(Object.fromEntries(operations())[name]!.responses['304'], name).toBeDefined();
    }
    const sync = Object.fromEntries(operations())['GET /api/v1/sync/places']!;
    expect(sync.responses['200']?.content?.['application/json']?.schema).toEqual({
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: { $ref: '#/components/schemas/SyncPlacesResponseDto' },
        meta: { $ref: '#/components/schemas/SyncMetaResponseDto' },
      },
    });
    expect(document.components.schemas.SyncMetaResponseDto).toBeDefined();
  });
});
