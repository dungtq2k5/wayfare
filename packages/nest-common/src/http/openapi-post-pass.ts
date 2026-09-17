import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { OpenAPIObject, OperationObject, PathItemObject } from '@nestjs/swagger';
import { compareStrings, ERRORS, zCursorMeta, zPageMeta } from '@wayfare/contracts';
import type { ErrorCode } from '@wayfare/contracts';
import { z } from 'zod';
import { effectiveAuth, effectiveRateLimitClass } from './auth-rules';
import type { EffectiveAuth } from './auth-rules';
import { USES_UPSTREAM } from './auth.decorators';
import { API_ENVELOPE, API_ERROR_CODES, ROUTE_REF_EXTENSION, routeRefOf } from './route-docs';
import type { EnvelopeDoc } from './route-docs';
import { SKIP_CLIENT_HEADER } from './skip-client-header.decorator';

/** The security schemes `@Auth` applies (conventions §5.7). */
export const AUTH_SCHEMES = {
  deviceBearer: 'deviceBearer',
  accountBearer: 'accountBearer',
  accessCookie: 'accessCookie',
  refreshCookie: 'refreshCookie',
} as const;

/** The shared list meta components. */
export const META_COMPONENTS = { cursor: 'CursorMeta', page: 'PageMeta' } as const;

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'] as const;

function errorEnvelopeSchema(codes: readonly ErrorCode[]) {
  return {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message', 'requestId'],
        properties: {
          code: { type: 'string', enum: [...codes] },
          message: { type: 'string' },
          details: { type: 'object', additionalProperties: true },
          requestId: { type: 'string' },
        },
      },
    },
  };
}

function securityOf(auth: EffectiveAuth): Record<string, string[]>[] | undefined {
  const scheme = (name: string) => ({ [name]: [] as string[] });
  if (auth.kind === 'permissions')
    return [scheme(AUTH_SCHEMES.accountBearer), scheme(AUTH_SCHEMES.accessCookie)];
  if (auth.kind !== 'marker') return undefined;
  const { rule } = auth;
  switch (rule.marker) {
    case 'PUBLIC':
      return rule.refreshCookie ? [scheme(AUTH_SCHEMES.refreshCookie)] : undefined;
    case 'SIGNATURE':
      return undefined;
    case 'DEVICE':
      return [
        scheme(AUTH_SCHEMES.deviceBearer),
        scheme(AUTH_SCHEMES.accountBearer),
        scheme(AUTH_SCHEMES.accessCookie),
      ];
    default:
      return [scheme(AUTH_SCHEMES.accountBearer), scheme(AUTH_SCHEMES.accessCookie)];
  }
}

function markerCodes(auth: EffectiveAuth): ErrorCode[] {
  if (auth.kind === 'permissions') return ['UNAUTHENTICATED', 'PERMISSION_DENIED'];
  if (auth.kind !== 'marker') return [];
  switch (auth.rule.marker) {
    case 'PUBLIC':
    case 'SIGNATURE':
      return [];
    case 'DEVICE':
      return ['UNAUTHENTICATED'];
    case 'USER':
      return ['UNAUTHENTICATED'];
    case 'USER_EMAIL':
      return ['UNAUTHENTICATED', 'EMAIL_NOT_VERIFIED'];
    case 'OWNER':
    case 'STAFF':
      return ['UNAUTHENTICATED', 'PERMISSION_DENIED'];
  }
}

function successStatus(method: string, envelope: EnvelopeDoc, handler: object): number {
  if (envelope.status !== undefined) return envelope.status;
  const code = Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined;
  if (code !== undefined) return code;
  return method === 'post' ? 201 : 200;
}

function successSchema(envelope: EnvelopeDoc) {
  const item = { $ref: `#/components/schemas/${envelope.model?.name ?? 'unknown'}` };
  if (envelope.list !== undefined) {
    return {
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: { type: 'array', items: item },
        meta: { $ref: `#/components/schemas/${META_COMPONENTS[envelope.list]}` },
      },
    };
  }
  if (envelope.array) {
    return {
      type: 'object',
      required: ['data'],
      properties: { data: { type: 'array', items: item } },
    };
  }
  return { type: 'object', required: ['data'], properties: { data: item } };
}

/**
 * Rewrites every documented operation into the wire contract (conventions §5.7): the success body
 * under its envelope and status, every error code grouped by its registered status, and the
 * security schemes of the route's marker. Undocumented operations are left alone — the OpenAPI
 * contract suite refuses them.
 */
export function applyWayfareOpenApi(document: OpenAPIObject): OpenAPIObject {
  const reflector = new Reflector();
  const schemas = (document.components ??= {}).schemas ?? {};
  document.components.schemas = schemas;
  schemas[META_COMPONENTS.cursor] = z.toJSONSchema(zCursorMeta) as never;
  schemas[META_COMPONENTS.page] = z.toJSONSchema(zPageMeta) as never;

  const pathItems: PathItemObject[] = Object.values(document.paths);
  for (const pathItem of pathItems) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as (OperationObject & Record<string, unknown>) | undefined;
      if (operation === undefined) continue;
      const ref = routeRefOf(operation[ROUTE_REF_EXTENSION]);
      delete operation[ROUTE_REF_EXTENSION];
      if (ref === undefined) continue;
      const { handler, controller } = ref;
      const targets = [handler, controller] as never[];
      const auth = effectiveAuth(reflector, handler as never, controller as never);
      const rateClass = effectiveRateLimitClass(
        reflector,
        handler as never,
        controller as never,
        auth,
      );
      const envelope = reflector.get<EnvelopeDoc | undefined>(API_ENVELOPE, handler);
      const routeCodes =
        reflector.get<readonly ErrorCode[] | undefined>(API_ERROR_CODES, handler) ?? [];

      const responses: Record<string, unknown> = {};
      if (envelope !== undefined) {
        const status = successStatus(method, envelope, handler);
        responses[String(status)] =
          envelope.model === null
            ? { description: envelope.description ?? 'No content' }
            : {
                description: envelope.description ?? 'Success',
                content: { 'application/json': { schema: successSchema(envelope) } },
              };
      }

      const hasInput =
        operation.requestBody !== undefined ||
        (operation.parameters ?? []).some(
          (parameter: object) => 'in' in parameter && parameter.in !== 'header',
        );
      const codes = new Set<ErrorCode>([...routeCodes, 'INTERNAL', ...markerCodes(auth)]);
      if (!reflector.getAllAndOverride<boolean | undefined>(SKIP_CLIENT_HEADER, targets))
        codes.add('CLIENT_HEADER_REQUIRED');
      if (rateClass !== null) codes.add('RATE_LIMITED');
      if (hasInput) codes.add('VALIDATION_FAILED');
      if (reflector.get<boolean | undefined>(USES_UPSTREAM, controller)) {
        codes.add('UPSTREAM_UNAVAILABLE');
        codes.add('UPSTREAM_TIMEOUT');
      }
      if (auth.kind === 'marker' && auth.rule.marker !== 'SIGNATURE')
        codes.add('APP_VERSION_UNSUPPORTED');
      if (auth.kind === 'permissions') codes.add('APP_VERSION_UNSUPPORTED');

      const byStatus = new Map<number, ErrorCode[]>();
      for (const code of [...codes].toSorted(compareStrings)) {
        const status = ERRORS[code].http;
        byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
      }
      for (const [status, grouped] of [...byStatus].toSorted(([a], [b]) => a - b)) {
        responses[String(status)] = {
          description: grouped.join(' | '),
          content: { 'application/json': { schema: errorEnvelopeSchema(grouped) } },
        };
      }
      operation.responses = responses as OperationObject['responses'];

      const security = securityOf(auth);
      if (security === undefined) delete operation.security;
      else operation.security = security;
    }
  }
  return document;
}
