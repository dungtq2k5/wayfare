import {
  applyDecorators,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  UseInterceptors,
} from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { canonicalJson, IDEMPOTENCY_TTL_MS, UUID_V7_PATTERN } from '@wayfare/contracts';
import type { Redis } from 'ioredis';
import { catchError, from, mergeMap, of } from 'rxjs';
import type { Observable } from 'rxjs';
import { deviceIdOf } from '../context/request-context';
import { sha256Hex } from '../crypto/tokens';
import { AppHttpException, ReplayedHttpError } from './app-http.exception';
import { resolveHttpError } from './error.filter';
import { authStateOf } from './request-context';
import { requestOf } from './request-of';

/** The header a ⟳ route requires (api-endpoints-plan §0.8). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** How long the first request of a key holds it: a repeat meanwhile is `IDEMPOTENCY_KEY_IN_FLIGHT`. */
export const IDEMPOTENCY_LOCK_MS = 60_000;

/** Injection token for the Redis the idempotency store uses. */
export const IDEMPOTENCY_REDIS = Symbol('IDEMPOTENCY_REDIS');

/** Metadata key: the route is ⟳. */
export const IDEMPOTENT = 'wayfare:idempotent';

/** A stored answer: the body's hash, and what the route returned or refused with. */
type StoredAnswer =
  | { readonly bodyHash: string; readonly kind: 'ok'; readonly value: unknown }
  | {
      readonly bodyHash: string;
      readonly kind: 'error';
      readonly status: number;
      readonly code: string;
      readonly details?: Record<string, unknown>;
    };

/** The request's body as a hash that ignores key order and text normalization differences. */
function bodyHashOf(body: unknown): string {
  try {
    return sha256Hex(canonicalJson(body ?? null));
  } catch {
    return sha256Hex(JSON.stringify(body ?? null));
  }
}

/**
 * The gateway's idempotency store (api-endpoints-plan §0.8): `(route, caller, key) → answer` in
 * Redis for `IDEMPOTENCY_TTL_MS`. A repeat with the same body replays the answer without calling
 * the service; another body is `422 IDEMPOTENCY_KEY_REUSED`; a repeat while the first still runs is
 * `409 IDEMPOTENCY_KEY_IN_FLIGHT`. `2xx` and `4xx` are stored, a `5xx` never — a retry after an
 * outage runs again. A store that cannot answer fails open, loudly: the key still reaches Stripe.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @Inject(IDEMPOTENCY_REDIS) private readonly redis: Pick<Redis, 'get' | 'set' | 'del'>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = requestOf(context);
    const key = request.header(IDEMPOTENCY_HEADER);
    if (key === undefined || key === '') throw new AppHttpException('IDEMPOTENCY_KEY_REQUIRED');
    if (!UUID_V7_PATTERN.test(key)) {
      throw new AppHttpException('VALIDATION_FAILED', {
        issues: [{ path: '/headers/idempotency-key', code: 'invalid_format' }],
      });
    }
    const caller = authStateOf(request).context;
    const who =
      caller.kind === 'account'
        ? `user:${caller.userId}`
        : `device:${deviceIdOf(caller) ?? request.ip}`;
    const route = `${request.method} ${(request.route as { path?: string } | undefined)?.path ?? request.path}`;
    const storeKey = `idem:${route}:${who}:${key}`;
    const bodyHash = bodyHashOf(request.body);
    return from(this.begin(storeKey, bodyHash)).pipe(
      mergeMap((begun) => {
        if (begun.kind === 'replay') return of(begun.value);
        return next.handle().pipe(
          mergeMap((value: unknown) =>
            from(this.finish(storeKey, { bodyHash, kind: 'ok', value }, begun.locked)).pipe(
              mergeMap(() => of(value)),
            ),
          ),
          catchError((error: unknown) => {
            const resolved = resolveHttpError(error);
            const answer: StoredAnswer | null =
              resolved.status < 500
                ? {
                    bodyHash,
                    kind: 'error',
                    status: resolved.status,
                    code: resolved.code,
                    ...(resolved.details === undefined ? {} : { details: resolved.details }),
                  }
                : null;
            return from(this.finish(storeKey, answer, begun.locked)).pipe(
              mergeMap(() => {
                throw error;
              }),
            );
          }),
        );
      }),
    );
  }

  /** Replays a stored answer, refuses a reused key or one in flight, or takes the key. */
  private async begin(
    storeKey: string,
    bodyHash: string,
  ): Promise<{ kind: 'replay'; value: unknown } | { kind: 'run'; locked: boolean }> {
    let stored: string | null;
    try {
      stored = await this.redis.get(storeKey);
    } catch (error) {
      this.failOpen(error);
      return { kind: 'run', locked: false };
    }
    if (stored !== null) {
      const answer = JSON.parse(stored) as StoredAnswer;
      if (answer.bodyHash !== bodyHash) throw new AppHttpException('IDEMPOTENCY_KEY_REUSED');
      if (answer.kind === 'ok') return { kind: 'replay', value: answer.value };
      throw new ReplayedHttpError(answer.status, answer.code, answer.details);
    }
    let taken: string | null;
    try {
      taken = await this.redis.set(`${storeKey}:lock`, '1', 'PX', IDEMPOTENCY_LOCK_MS, 'NX');
    } catch (error) {
      this.failOpen(error);
      return { kind: 'run', locked: false };
    }
    if (taken === null) throw new AppHttpException('IDEMPOTENCY_KEY_IN_FLIGHT');
    return { kind: 'run', locked: true };
  }

  /** Stores the answer (none for a `5xx`) and releases the key. */
  private async finish(
    storeKey: string,
    answer: StoredAnswer | null,
    locked: boolean,
  ): Promise<void> {
    try {
      if (answer !== null) {
        await this.redis.set(storeKey, JSON.stringify(answer), 'PX', IDEMPOTENCY_TTL_MS);
      }
      if (locked) await this.redis.del(`${storeKey}:lock`);
    } catch (error) {
      this.failOpen(error);
    }
  }

  private failOpen(error: unknown): void {
    this.logger.error(
      { alert: true, err: error instanceof Error ? error.message : String(error) },
      'idempotency store unavailable — failing open',
    );
  }
}

/**
 * Marks a ⟳ route (api-endpoints-plan §0.8): `Idempotency-Key` required, answers replayed. The
 * module that owns the route provides `IDEMPOTENCY_REDIS`.
 */
export function Idempotent(): MethodDecorator {
  return applyDecorators(
    SetMetadata(IDEMPOTENT, true),
    ApiHeader({
      name: IDEMPOTENCY_HEADER,
      required: true,
      description: 'A UUIDv7 per intended operation; a retry sends the same key.',
    }),
    UseInterceptors(IdempotencyInterceptor),
  );
}
