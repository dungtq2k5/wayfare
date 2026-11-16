import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErrorFilter } from './error.filter';
import { ETagged, ETaggedResult, ETagInterceptor, ifNoneMatchHits } from './etag';
import { WithMeta } from './paged';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';
import { ResponseValidationInterceptor } from './response-validation.interceptor';

class ItemDto extends createZodDto(z.object({ id: z.string() })) {}

@Controller()
class TaggedController {
  @Get('tagged')
  @ETagged()
  @ZodSerializerDto(ItemDto)
  tagged(): ETaggedResult<ItemDto> {
    return ETaggedResult.of({ id: 'a' }, 'area:en:42');
  }

  @Get('with-meta')
  @ETagged()
  @ZodSerializerDto(ItemDto)
  withMeta(): ETaggedResult<WithMeta<ItemDto>> {
    return ETaggedResult.of(WithMeta.of({ id: 'b' }, { complete: true }), '7');
  }

  @Get('forgot')
  @ETagged()
  forgot(): ItemDto {
    return { id: 'c' };
  }
}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ controllers: [TaggedController] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  const reflector = app.get(Reflector);
  // The gateway's order: envelope, validation, then the ETag check innermost.
  app.useGlobalInterceptors(
    new ResponseEnvelopeInterceptor(reflector),
    new ResponseValidationInterceptor(reflector, false),
    new ETagInterceptor(reflector),
  );
  app.useGlobalFilters(new ErrorFilter(false));
  await app.init();
});

afterAll(() => app.close());

describe('ETagged routes', () => {
  it('answer with the tag, a revalidating cache policy and the envelope', async () => {
    const res = await request(app.getHttpServer()).get('/tagged');
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe('"area:en:42"');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.body).toEqual({ data: { id: 'a' } });
  });

  it('answer a matching If-None-Match with an empty 304', async () => {
    const res = await request(app.getHttpServer())
      .get('/tagged')
      .set('If-None-Match', 'W/"other", "area:en:42"');
    expect(res.status).toBe(304);
    expect(res.headers.etag).toBe('"area:en:42"');
    expect(res.text ?? '').toBe('');
  });

  it('answer a stale tag in full, meta included', async () => {
    const res = await request(app.getHttpServer()).get('/with-meta').set('If-None-Match', '"6"');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { id: 'b' }, meta: { complete: true } });
  });

  it('refuse a handler that forgot to return a tagged result', async () => {
    const res = await request(app.getHttpServer()).get('/forgot');
    expect(res.status).toBe(500);
  });
});

describe('ifNoneMatchHits', () => {
  it('compares weakly, in a list, and honours *', () => {
    expect(ifNoneMatchHits('"a"', '"a"')).toBe(true);
    expect(ifNoneMatchHits('W/"a"', '"a"')).toBe(true);
    expect(ifNoneMatchHits(' "b" , "a"', '"a"')).toBe(true);
    expect(ifNoneMatchHits('*', '"a"')).toBe(true);
    expect(ifNoneMatchHits('"b"', '"a"')).toBe(false);
    expect(ifNoneMatchHits(undefined, '"a"')).toBe(false);
  });

  it('keeps a tag well-formed whatever the version holds', () => {
    expect(ETaggedResult.of(null, 'a"b\\c').etag).toBe('"abc"');
  });
});
