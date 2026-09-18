import {
  PROVIDER_CALL_TIMEOUT_MS,
  PROVIDER_COOLDOWN_MS,
  PROVIDER_FAILURE_THRESHOLD,
} from '@wayfare/contracts';

/**
 * A refusal of the input itself — a sentence over the limit, a language the provider cannot take.
 * The next provider would refuse it too, so it fails the task without failing over (conventions §11.5).
 */
export class InputRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InputRefusedError';
  }
}

/** Every provider was tried or skipped, and none answered. */
export class NoProviderAnsweredError extends Error {
  constructor(role: string, reasons: readonly string[]) {
    super(
      reasons.length === 0
        ? `no ${role} provider is available`
        : `every ${role} provider failed: ${reasons.join('; ')}`,
    );
    this.name = 'NoProviderAnsweredError';
  }
}

/** The breaker state of one provider, as `providers-health` reports it. */
export interface ProviderState {
  readonly name: string;
  readonly position: number;
  readonly breaker: 'closed' | 'open';
  readonly consecutiveFailures: number;
  readonly errorRate: number;
  readonly recentCalls: number;
  readonly coolingUntil: Date | null;
}

/** How many recent calls the error rate covers. */
export const ERROR_RATE_WINDOW = 100;

interface Breaker {
  consecutiveFailures: number;
  coolingUntil: number | null;
  recent: boolean[];
}

const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '') ||
  (Buffer.isBuffer(value) && value.length === 0);

/**
 * The configured providers of one role, in order (conventions §11.5): each call tries the eligible
 * providers that are not cooling down, and fails over on a timeout, a network error, a 5xx, a 429
 * or an empty result. After `PROVIDER_FAILURE_THRESHOLD` consecutive failures a provider is skipped
 * for `PROVIDER_COOLDOWN_MS`. The state is per process.
 */
export class ProviderChain<P extends { readonly name: string }> {
  private readonly breakers = new Map<string, Breaker>();

  constructor(
    readonly role: 'translation' | 'speech',
    readonly providers: readonly P[],
    private readonly options: {
      readonly timeoutMs?: number;
      readonly threshold?: number;
      readonly cooldownMs?: number;
      readonly now?: () => number;
    } = {},
  ) {
    for (const provider of providers) {
      this.breakers.set(provider.name, { consecutiveFailures: 0, coolingUntil: null, recent: [] });
    }
  }

  /** The providers a call would try now, in order: eligible, and not cooling down. */
  candidates(eligible: (provider: P) => boolean = () => true): P[] {
    const now = this.now();
    return this.providers.filter((provider) => {
      const breaker = this.breakers.get(provider.name)!;
      return eligible(provider) && (breaker.coolingUntil === null || breaker.coolingUntil <= now);
    });
  }

  /** Runs `call` on each candidate in turn until one answers. */
  async run<T>(
    eligible: (provider: P) => boolean,
    call: (provider: P) => Promise<T>,
  ): Promise<{ result: T; provider: P }> {
    const reasons: string[] = [];
    for (const provider of this.candidates(eligible)) {
      try {
        const result = await this.withTimeout(call(provider));
        if (isEmpty(result)) throw new Error('empty result');
        this.record(provider.name, true);
        return { result, provider };
      } catch (error) {
        if (error instanceof InputRefusedError) throw error;
        this.record(provider.name, false);
        reasons.push(`${provider.name}: ${redact(error)}`);
      }
    }
    throw new NoProviderAnsweredError(this.role, reasons);
  }

  /** Every provider's state. */
  states(): ProviderState[] {
    const now = this.now();
    return this.providers.map((provider, position) => {
      const breaker = this.breakers.get(provider.name)!;
      const open = breaker.coolingUntil !== null && breaker.coolingUntil > now;
      const failures = breaker.recent.filter((ok) => !ok).length;
      return {
        name: provider.name,
        position,
        breaker: open ? 'open' : 'closed',
        consecutiveFailures: breaker.consecutiveFailures,
        errorRate: breaker.recent.length === 0 ? 0 : failures / breaker.recent.length,
        recentCalls: breaker.recent.length,
        coolingUntil: open ? new Date(breaker.coolingUntil!) : null,
      };
    });
  }

  private record(name: string, ok: boolean): void {
    const breaker = this.breakers.get(name)!;
    breaker.recent.push(ok);
    if (breaker.recent.length > ERROR_RATE_WINDOW) breaker.recent.shift();
    if (ok) {
      breaker.consecutiveFailures = 0;
      breaker.coolingUntil = null;
      return;
    }
    breaker.consecutiveFailures += 1;
    if (breaker.consecutiveFailures >= (this.options.threshold ?? PROVIDER_FAILURE_THRESHOLD)) {
      breaker.coolingUntil = this.now() + (this.options.cooldownMs ?? PROVIDER_COOLDOWN_MS);
      // The next failure after the cooldown opens it again at once.
      breaker.consecutiveFailures = (this.options.threshold ?? PROVIDER_FAILURE_THRESHOLD) - 1;
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    const ms = this.options.timeoutMs ?? PROVIDER_CALL_TIMEOUT_MS;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}

/** A failure's message, on one line and short: never a provider's full response body. */
export function redact(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 200);
}
