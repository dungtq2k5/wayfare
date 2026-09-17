import { Injectable, Logger } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { normalizeEmail } from '@wayfare/contracts';
import type { RateLimitKey } from '@wayfare/contracts';
import type { Request } from 'express';
import { deviceIdOf } from '../context/request-context';
import type { RequestContext } from '../context/request-context';
import { AppHttpException } from './app-http.exception';
import { effectiveAuth, effectiveRateLimitClass } from './auth-rules';
import { RateLimiter } from './rate-limiter';
import { authStateOf } from './request-context';
import { requestOf } from './request-of';

/** The bucket values a request offers. */
export function rateLimitValues(
  request: Request,
  context: RequestContext,
): Partial<Record<RateLimitKey, string>> {
  const body = request.body as { email?: unknown } | undefined;
  const deviceId = deviceIdOf(context);
  return {
    ...(request.ip === undefined ? {} : { ip: request.ip }),
    ...(typeof body?.email === 'string' ? { email: normalizeEmail(body.email) } : {}),
    ...(deviceId === null ? {} : { deviceId }),
    ...(context.kind === 'account' ? { userId: context.userId } : {}),
  };
}

/**
 * Applies the route's one rate-limit class (api-endpoints-plan §0.9) — last in the guard chain,
 * after the caller is known. A store failure fails **open** and raises an alert: a Redis outage
 * must not become a total outage, and the log line is the signal the protection is off.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const handler = context.getHandler();
    const controller = context.getClass();
    const cls = effectiveRateLimitClass(
      this.reflector,
      handler,
      controller,
      effectiveAuth(this.reflector, handler, controller),
    );
    if (cls === null) return true;
    const request = requestOf(context);
    let verdict;
    try {
      verdict = await this.limiter.hit(cls, rateLimitValues(request, authStateOf(request).context));
    } catch (error) {
      this.logger.error(
        { alert: true, class: cls, err: error instanceof Error ? error.message : String(error) },
        'rate limit store unavailable — failing open',
      );
      return true;
    }
    if (!verdict.allowed)
      throw new AppHttpException('RATE_LIMITED', { retryAfterSeconds: verdict.retryAfterSeconds });
    return true;
  }
}
