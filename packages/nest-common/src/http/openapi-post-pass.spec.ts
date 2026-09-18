import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { createZodDto, cleanupOpenApiDoc } from 'nestjs-zod';
import { compareStrings } from '@wayfare/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiEnvelope } from './api-envelope.decorator';
import { ApiErrors } from './api-errors.decorator';
import { Auth, RateLimit, UsesUpstream } from './auth.decorators';
import { ETagged } from './etag';
import { applyWayfareOpenApi } from './openapi-post-pass';

class ThingDto extends createZodDto(z.object({ id: z.string() })) {}
class ThingBodyDto extends createZodDto(z.object({ name: z.string() })) {}
class ThingMetaDto extends createZodDto(z.object({ complete: z.boolean() })) {}
class PendingThingDto extends createZodDto(z.object({ jobId: z.string() })) {}

@UsesUpstream()
@Controller('things')
class ThingsController {
  @Post()
  @Auth('USER')
  @ApiEnvelope(ThingDto)
  @ApiErrors('EMAIL_TAKEN')
  create(@Body() _body: ThingBodyDto) {}

  // @HttpCode above @ApiEnvelope: decorators apply bottom-up, so it is set after it.
  @HttpCode(200)
  @Post('refresh')
  @Auth('PUBLIC', { refreshCookie: true })
  @ApiEnvelope(ThingDto)
  refresh() {}

  @Post('below')
  @Auth('PUBLIC')
  @ApiEnvelope(ThingDto)
  @HttpCode(202)
  below() {}

  @Get()
  @Auth('DEVICE')
  @ApiEnvelope(ThingDto, { list: 'cursor' })
  list() {}

  @Get('all')
  @Auth('USER_EMAIL')
  @ApiEnvelope(ThingDto, { array: true })
  all() {}

  @Get('page')
  @Auth('DEVICE')
  @ETagged()
  @ApiEnvelope(ThingDto, { meta: ThingMetaDto })
  page() {}

  @Get('picture')
  @Auth('USER')
  @ApiEnvelope(null, { status: 200, mediaType: 'image/svg+xml' })
  picture() {}

  @HttpCode(200)
  @Post('maybe')
  @Auth('DEVICE')
  @ApiEnvelope(ThingDto, { alternatives: [{ status: 202, model: PendingThingDto }] })
  maybe() {}

  @Delete()
  @Auth('SIGNATURE')
  @RateLimit(null)
  @HttpCode(204)
  @ApiEnvelope(null)
  remove() {}
}

let app: INestApplication;
let document: ReturnType<typeof applyWayfareOpenApi>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ controllers: [ThingsController] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  document = applyWayfareOpenApi(
    cleanupOpenApiDoc(
      SwaggerModule.createDocument(app, { openapi: '3.0.0', info: { title: 't', version: '1' } }),
    ),
  );
});

afterAll(() => app.close());

/** The loose view of a documented operation the assertions read. */
interface Doc {
  description?: string;
  content?: Record<string, { schema: DocSchema }>;
}
interface DocSchema {
  properties?: Record<string, DocSchema & { enum?: string[] }>;
}
/** A documented response's JSON schema; throws when the response is missing. */
function schemaOf(path: string, method: string, status: string): DocSchema {
  const schema = op(path, method).responses[status]?.content?.['application/json']?.schema;
  if (schema === undefined) throw new Error(`No ${status} JSON response on ${method} ${path}`);
  return schema;
}

const op = (path: string, method: string) =>
  (document.paths[path] as Record<string, { responses: Record<string, Doc>; security?: unknown }>)[
    method
  ]!;

describe('OpenAPI post-pass', () => {
  it('documents the envelope under the resolved status, whatever the decorator order', () => {
    expect(Object.keys(op('/things', 'post').responses)).toContain('201');
    expect(schemaOf('/things', 'post', '201')).toEqual({
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/ThingDto' } },
    });
    expect(Object.keys(op('/things/refresh', 'post').responses)).toContain('200');
    expect(Object.keys(op('/things/below', 'post').responses)).toContain('202');
    expect(op('/things', 'delete').responses['204']).toEqual({ description: 'No content' });
    expect(document.components?.schemas?.ThingDto).toBeDefined();
  });

  it('documents lists with the shared meta, and arrays without', () => {
    expect(schemaOf('/things', 'get', '200').properties?.meta).toEqual({
      $ref: '#/components/schemas/CursorMeta',
    });
    expect(schemaOf('/things/all', 'get', '200').properties).toEqual({
      data: { type: 'array', items: { $ref: '#/components/schemas/ThingDto' } },
    });
  });

  it('adds the automatic error codes, grouped by status', () => {
    const codes = (path: string, method: string) =>
      Object.values(op(path, method).responses).flatMap(
        (response) =>
          response.content?.['application/json']?.schema.properties?.error?.properties?.code
            ?.enum ?? [],
      );
    expect(codes('/things', 'post').toSorted(compareStrings)).toEqual(
      [
        'APP_VERSION_UNSUPPORTED',
        'CLIENT_HEADER_REQUIRED',
        'EMAIL_TAKEN',
        'INTERNAL',
        'RATE_LIMITED',
        'UNAUTHENTICATED',
        'UPSTREAM_TIMEOUT',
        'UPSTREAM_UNAVAILABLE',
        'VALIDATION_FAILED',
      ].toSorted(compareStrings),
    );
    expect(op('/things', 'post').responses['409']?.description).toBe('EMAIL_TAKEN');
    expect(codes('/things', 'delete')).not.toContain('RATE_LIMITED');
    expect(codes('/things/all', 'get')).toContain('EMAIL_NOT_VERIFIED');
  });

  it("applies the marker's security schemes", () => {
    expect(op('/things', 'post').security).toEqual([{ accountBearer: [] }, { accessCookie: [] }]);
    expect(op('/things/refresh', 'post').security).toEqual([{ refreshCookie: [] }]);
    expect(op('/things/below', 'post').security).toBeUndefined();
    expect(op('/things', 'get').security).toEqual([
      { deviceBearer: [] },
      { accountBearer: [] },
      { accessCookie: [] },
    ]);
    expect(JSON.stringify(document)).not.toContain('x-wayfare-route');
  });

  it("documents a route's own meta, a tagged read's 304, and a non-JSON body", () => {
    expect(schemaOf('/things/page', 'get', '200')).toEqual({
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: { $ref: '#/components/schemas/ThingDto' },
        meta: { $ref: '#/components/schemas/ThingMetaDto' },
      },
    });
    expect(document.components?.schemas?.ThingMetaDto).toBeDefined();
    expect(op('/things/page', 'get').responses['304']).toBeDefined();
    expect(op('/things', 'get').responses['304']).toBeUndefined();
    expect(op('/things/picture', 'get').responses['200']).toEqual({
      description: 'Success',
      content: { 'image/svg+xml': { schema: { type: 'string' } } },
    });
  });

  it('documents a second success status with its own model', () => {
    expect(
      Object.keys(op('/things/maybe', 'post').responses).filter((status) => status.startsWith('2')),
    ).toEqual(['200', '202']);
    expect(schemaOf('/things/maybe', 'post', '202')).toEqual({
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/PendingThingDto' } },
    });
    expect(document.components?.schemas?.PendingThingDto).toBeDefined();
  });
});
