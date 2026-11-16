import {
  PROVIDER_OUTAGE_BACKOFF_MS,
  PROVIDER_OUTAGE_RETRY_WINDOW_MS,
  SYNTHESIS_RETRY_BACKOFF_MS,
  SYNTHESIS_TASK_ATTEMPTS,
  SynthesisFailureReason,
} from '@wayfare/contracts';

/** A task's counts before the attempt that failed, and how it failed. */
export interface FailedAttempt {
  readonly attempts: number;
  readonly providerWaits: number;
  readonly providerDownSince: Date | null;
  /** The input itself was refused: no provider would take it. */
  readonly refused: boolean;
  /** No speech provider could be reached. */
  readonly providerUnavailable: boolean;
  readonly now: Date;
}

/** What the task becomes: failed for good, or queued again after `delayMs`. */
export type AttemptOutcome =
  | { readonly final: true; readonly attempts: number; readonly providerWaits: number }
  | {
      readonly final: false;
      readonly attempts: number;
      readonly providerWaits: number;
      readonly providerDownSince: Date | null;
      readonly failureReason: SynthesisFailureReason | null;
      readonly delayMs: number;
    };

const delay = (backoff: readonly number[], nth: number): number =>
  backoff[Math.min(nth, backoff.length) - 1]!;

/**
 * A failed attempt's outcome (rdm-spec N-2). Every attempt raises `attempts`, so each retry is a
 * new queue item; one taken by a speech-provider outage also raises `providerWaits`, and only the
 * others count toward `SYNTHESIS_TASK_ATTEMPTS`. An outage retries on its own longer back-off until
 * `PROVIDER_OUTAGE_RETRY_WINDOW_MS` after it began; any other failure ends the outage.
 */
export function attemptOutcome(failed: FailedAttempt): AttemptOutcome {
  const attempts = failed.attempts + 1;
  if (failed.refused) return { final: true, attempts, providerWaits: failed.providerWaits };
  if (failed.providerUnavailable) {
    const providerWaits = failed.providerWaits + 1;
    const since = failed.providerDownSince ?? failed.now;
    if (failed.now.getTime() - since.getTime() >= PROVIDER_OUTAGE_RETRY_WINDOW_MS) {
      return { final: true, attempts, providerWaits };
    }
    return {
      final: false,
      attempts,
      providerWaits,
      providerDownSince: since,
      failureReason: SynthesisFailureReason.PROVIDER_UNAVAILABLE,
      delayMs: delay(PROVIDER_OUTAGE_BACKOFF_MS, providerWaits),
    };
  }
  const counted = attempts - failed.providerWaits;
  if (counted >= SYNTHESIS_TASK_ATTEMPTS) {
    return { final: true, attempts, providerWaits: failed.providerWaits };
  }
  return {
    final: false,
    attempts,
    providerWaits: failed.providerWaits,
    providerDownSince: null,
    failureReason: null,
    delayMs: delay(SYNTHESIS_RETRY_BACKOFF_MS, counted),
  };
}
