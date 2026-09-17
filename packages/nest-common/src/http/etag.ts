import { applyDecorators, Header, HttpStatus, SetMetadata } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';

/** Metadata key: the route answers with an `ETaggedResult`. */
export const ETAGGED = 'wayfare:etagged';

/**
 * A handler's value and the version it represents. The interceptor turns the version into the
 * `ETag`; the value is what the envelope carries — a plain value or a `WithMeta`.
 */
export class ETaggedResult<T> {
  private constructor(
    readonly value: T,
    readonly version: string,
  ) {}

  static of<T>(value: T, version: string): ETaggedResult<T> {
    return new ETaggedResult(value, version);
  }

  /** The strong entity tag for the version. */
  get etag(): string {
    return `"${this.version.replace(/["\\]/g, '')}"`;
  }
}

/** What a conditional request that matched becomes: no body, and nothing to validate or wrap. */
export class NotModified {
  static readonly instance = new NotModified();
  private constructor() {}
}

/**
 * Tourist reads answer `ETag`, and a matching `If-None-Match` answers `304` with no body
 * (api-endpoints-plan §0.7). The handler returns `ETaggedResult.of(value, version)`. Clients
 * revalidate on every use: `private, no-cache`.
 */
export function ETagged(): MethodDecorator {
  return applyDecorators(SetMetadata(ETAGGED, true), Header('Cache-Control', 'private, no-cache'));
}

/** True when an `If-None-Match` header names the tag (weak comparison, RFC 9110 §13.1.2). */
export function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === '*') return true;
  const strip = (tag: string) => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => strip(tag) === strip(etag));
}

/**
 * Sets `ETag` and answers a matching conditional request with `304` — before response validation
 * and the envelope, which pass `NotModified` through. Registered LAST, so it runs FIRST on the way
 * out.
 */
export class ETagInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const tagged = this.reflector.get<boolean | undefined>(ETAGGED, context.getHandler());
    if (!tagged) return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    return next.handle().pipe(
      map((result: unknown) => {
        if (!(result instanceof ETaggedResult)) {
          throw new Error('An @ETagged() route must return an ETaggedResult');
        }
        response.setHeader('ETag', result.etag);
        if (ifNoneMatchHits(request.headers['if-none-match'], result.etag)) {
          response.status(HttpStatus.NOT_MODIFIED);
          return NotModified.instance;
        }
        return result.value as unknown;
      }),
    );
  }
}
