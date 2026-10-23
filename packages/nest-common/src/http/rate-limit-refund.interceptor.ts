import { Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { catchError, from, mergeMap, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import { resolveHttpError } from './error.filter';
import { RATE_LIMIT_RESERVED } from './rate-limit.guard';
import type { ReservedRequest } from './rate-limit.guard';
import type { RateLimiter } from './rate-limiter';
import { requestOf } from './request-of';

/**
 * The second half of a `countFailuresOnly` class (api-endpoints-plan §0.9): `RateLimitGuard`
 * counted the attempt up front, so parallel guesses cannot all slip past; this takes the count back
 * when the answer is not a failure. A refund the store refuses is logged and dropped — the request's
 * answer never depends on it.
 */
export class RateLimitRefundInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitRefundInterceptor.name);

  constructor(private readonly limiter: RateLimiter) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const reserved = (requestOf(context) as ReservedRequest)[RATE_LIMIT_RESERVED];
    if (reserved === undefined || reserved.keys.length === 0) return next.handle();
    // The class's failure codes stay counted (a wrong password, the guess the limit is for); a
    // success, a locked account or a malformed body is no guess, and is given back.
    const refund = () =>
      this.limiter.refund(reserved.keys).catch((error: unknown) => {
        this.logger.warn(
          { err: error instanceof Error ? error.message : String(error) },
          'rate limit refund failed',
        );
      });
    return next.handle().pipe(
      mergeMap((value: unknown) => from(refund().then(() => value))),
      catchError((error: unknown) =>
        reserved.failures.includes(resolveHttpError(error).code)
          ? throwError(() => error)
          : from(refund()).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }
}
