import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootGateway } from '../support/app';
import type { E2eApp } from '../support/app';

interface Operation {
  responses: Record<
    string,
    { content?: Record<string, { schema: { properties?: Record<string, unknown> } }> }
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
]);

describe('OpenAPI contract', () => {
  it('documents every route of this build, and no probe', () => {
    const names = operations().map(([name]) => name);
    expect(names).toHaveLength(44);
    // Provider webhooks are not client routes; they stay out of the document.
    expect(names.some((name) => name.includes('/webhooks/'))).toBe(false);
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
      expect(success, name).toHaveLength(1);
      const [status] = success;
      if (status === '204' || status === '202')
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
      if (NO_SECURITY.has(name)) expect(operation.security, name).toBeUndefined();
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
});
