import { Inject, Injectable } from '@nestjs/common';
import { toErrorMessage } from '../errors/poison-message';

/** One dependency a service declares for readiness — its own database, Redis, NATS or GCS. Never a gRPC peer. */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

/** Injection token for the service's `ReadinessCheck[]`. */
export const READINESS_CHECKS = Symbol('READINESS_CHECKS');

/** Per-check timeout; a hung dependency must not hang the probe. */
export const READINESS_CHECK_TIMEOUT_MS = 2_000;

/** The outcome of one readiness evaluation. */
export interface ReadinessReport {
  readonly ready: boolean;
  readonly checks: Record<string, { readonly ok: boolean; readonly error?: string }>;
}

/** Evaluates every declared dependency (api-endpoints-plan §13). */
@Injectable()
export class ReadinessService {
  constructor(@Inject(READINESS_CHECKS) private readonly checks: readonly ReadinessCheck[]) {}

  async check(): Promise<ReadinessReport> {
    const results = await Promise.all(
      this.checks.map(async (dependency): Promise<[string, ReadinessReport['checks'][string]]> => {
        try {
          await withTimeout(dependency.check(), READINESS_CHECK_TIMEOUT_MS);
          return [dependency.name, { ok: true }];
        } catch (error) {
          return [dependency.name, { ok: false, error: toErrorMessage(error) }];
        }
      }),
    );
    return {
      ready: results.every(([, result]) => result.ok),
      checks: Object.fromEntries(results),
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
