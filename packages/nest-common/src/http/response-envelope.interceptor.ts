import { StreamableFile } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';
import { NotModified } from './etag';
import { WithMeta } from './paged';
import { SKIP_ENVELOPE } from './skip-envelope.decorator';

/** The success envelope: `{ data }`, plus `meta` when there is something to say. */
export type Envelope = { data: unknown; meta?: Record<string, unknown> };

/**
 * Wraps every successful HTTP response as `{ data, meta? }` (conventions §5.1).
 * Handlers return raw data, a `Paged` or a `WithMeta`; returning `{ data }` yourself double-wraps.
 * Routes marked `@SkipEnvelope()` — the ops routes — are served unwrapped.
 * Registered FIRST so it runs LAST on the way out — after response validation.
 */
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_ENVELOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();
    return next.handle().pipe(map((value: unknown) => wrap(value)));
  }
}

function wrap(value: unknown): unknown {
  if (value instanceof StreamableFile) return value;
  // A 304 has no body.
  if (value instanceof NotModified) return undefined;
  if (value instanceof WithMeta) return { data: value.data, meta: value.meta } satisfies Envelope;
  return { data: value ?? null } satisfies Envelope;
}
