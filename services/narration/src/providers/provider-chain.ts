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

/** The network codes of a provider that could not be reached at all (rdm-spec N-2). */
const UNREACHABLE_CODES = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** A call the chain gave up on after `PROVIDER_CALL_TIMEOUT_MS`. */
export class ProviderTimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms} ms`);
    this.name = 'ProviderTimeoutError';
  }
}

const codeOf = (value: unknown): unknown =>
  typeof value === 'object' && value !== null ? (value as { code?: unknown }).code : undefined;

/**
 * Whether a failure says the provider could not be reached — a timeout, or a network error on the
 * error or its cause (Edge's WebSocket wraps `getaddrinfo EAI_AGAIN` that way) — rather than an
 * answer it refused or got wrong.
 */
export function isUnreachable(error: unknown): boolean {
  if (error instanceof ProviderTimeoutError) return true;
  const cause = error instanceof Error ? error.cause : undefined;
  return [codeOf(error), codeOf(cause)].some(
    (code) => typeof code === 'string' && UNREACHABLE_CODES.has(code),
  );
}

/** Every provider was tried or skipped, and none answered. */
export class NoProviderAnsweredError extends Error {
  /**
   * True when there was a provider for the call and none could be reached: each one tried failed
   * unreachable, and each one skipped is cooling down after such a failure. A task waits out an
   * outage like that without spending its attempts (rdm-spec N-2).
   */
  readonly unreachable: boolean;

  constructor(
    readonly role: 'translation' | 'speech',
    reasons: readonly string[],
    unreachable = false,
  ) {
    super(
      reasons.length === 0
        ? `no ${role} provider is available`
        : `every ${role} provider failed: ${reasons.join('; ')}`,
    );
    this.name = 'NoProviderAnsweredError';
    this.unreachable = unreachable;
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
  /** While open: when it first stopped answering in this outage, through reopenings. */
  readonly downSince: Date | null;
}

/** How many recent calls the error rate covers. */
export const ERROR_RATE_WINDOW = 100;

interface Breaker {
  consecutiveFailures: number;
  coolingUntil: number | null;
  /** When the breaker first opened in this outage; cleared by an answer. */
  downSince: number | null;
  recent: boolean[];
  /** Whether its last failure was a provider that could not be reached. */
  lastUnreachable: boolean;
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
      this.breakers.set(provider.name, {
        consecutiveFailures: 0,
        coolingUntil: null,
        downSince: null,
        recent: [],
        lastUnreachable: false,
      });
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
    const candidates = this.candidates(eligible);
    // The eligible providers skipped for cooling down count by why they last failed.
    const unreachable = this.providers
      .filter((provider) => eligible(provider) && !candidates.includes(provider))
      .map((provider) => this.breakers.get(provider.name)!.lastUnreachable);
    for (const provider of candidates) {
      try {
        const result = await this.withTimeout(call(provider));
        if (isEmpty(result)) throw new Error('empty result');
        this.record(provider.name, true);
        return { result, provider };
      } catch (error) {
        if (error instanceof InputRefusedError) throw error;
        this.record(provider.name, false, isUnreachable(error));
        unreachable.push(isUnreachable(error));
        reasons.push(`${provider.name}: ${redact(error)}`);
      }
    }
    throw new NoProviderAnsweredError(
      this.role,
      reasons,
      unreachable.length > 0 && unreachable.every(Boolean),
    );
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
        downSince: open && breaker.downSince !== null ? new Date(breaker.downSince) : null,
      };
    });
  }

  private record(name: string, ok: boolean, unreachable = false): void {
    const breaker = this.breakers.get(name)!;
    if (!ok) breaker.lastUnreachable = unreachable;
    breaker.recent.push(ok);
    if (breaker.recent.length > ERROR_RATE_WINDOW) breaker.recent.shift();
    if (ok) {
      breaker.consecutiveFailures = 0;
      breaker.coolingUntil = null;
      breaker.downSince = null;
      return;
    }
    breaker.consecutiveFailures += 1;
    if (breaker.consecutiveFailures >= (this.options.threshold ?? PROVIDER_FAILURE_THRESHOLD)) {
      breaker.coolingUntil = this.now() + (this.options.cooldownMs ?? PROVIDER_COOLDOWN_MS);
      breaker.downSince ??= this.now();
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
      const timer = setTimeout(() => reject(new ProviderTimeoutError(ms)), ms);
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
