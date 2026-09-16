import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErrorFilter } from './error.filter';
import { Paged } from './paged';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';
import { ResponseValidationInterceptor } from './response-validation.interceptor';
import { SkipEnvelope } from './skip-envelope.decorator';

class ItemDto extends createZodDto(z.object({ id: z.string() })) {}

@Controller()
class ProbeController {
  @Get('ok')
  @ZodResponse({ type: ItemDto })
  ok(): ItemDto {
    return { id: 'a' };
  }

  @Get('leaky')
  @ZodResponse({ type: ItemDto })
  leaky(): ItemDto {
    return { id: 'a', passwordHash: 'x' } as ItemDto;
  }

  @Get('wrong')
  @ZodResponse({ type: ItemDto })
  wrong(): ItemDto {
    return { id: 1 } as unknown as ItemDto;
  }

  @Get('list')
  @ZodResponse({ type: [ItemDto] })
  list(): ItemDto[] {
    return Paged.cursor([{ id: 'a' }], 'next') as unknown as ItemDto[];
  }

  @Get('raw')
  @SkipEnvelope()
  raw(): { ready: boolean } {
    return { ready: true };
  }

  @Get('untyped')
  untyped(): { anything: boolean } {
    return { anything: true };
  }
}

async function boot(isProduction: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  // Same order as the gateway: the envelope FIRST, so it runs LAST on the way out.
  app.useGlobalInterceptors(
    new ResponseEnvelopeInterceptor(app.get(Reflector)),
    new ResponseValidationInterceptor(app.get(Reflector), isProduction),
  );
  app.useGlobalFilters(new ErrorFilter(isProduction));
  await app.init();
  return app;
}

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('response pipeline', () => {
  it('validates the RAW value and then wraps it in { data }', async () => {
    app = await boot(false);
    const res = await request(app.getHttpServer()).get('/ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { id: 'a' } });
  });

  it('fails a response carrying an UNDECLARED field in development', async () => {
    app = await boot(false);
    const res = await request(app.getHttpServer()).get('/leaky');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(res.body.error.message).toMatch(/passwordHash/);
  });

  it('strips an undeclared field in production', async () => {
    app = await boot(true);
    const res = await request(app.getHttpServer()).get('/leaky');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { id: 'a' } });
  });

  it('answers 500 for a value that fails its schema, even in production', async () => {
    app = await boot(true);
    const res = await request(app.getHttpServer()).get('/wrong');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL', message: 'Something went wrong' });
  });

  it('checks each item of a Paged list and puts meta beside data', async () => {
    app = await boot(false);
    const res = await request(app.getHttpServer()).get('/list');
    expect(res.body).toEqual({ data: [{ id: 'a' }], meta: { nextCursor: 'next' } });
  });

  it('serves a @SkipEnvelope route unwrapped', async () => {
    app = await boot(false);
    const res = await request(app.getHttpServer()).get('/raw');
    expect(res.body).toEqual({ ready: true });
  });

  it('passes a route without a declared schema through, still enveloped', async () => {
    app = await boot(false);
    const res = await request(app.getHttpServer()).get('/untyped');
    expect(res.body).toEqual({ data: { anything: true } });
  });
});
