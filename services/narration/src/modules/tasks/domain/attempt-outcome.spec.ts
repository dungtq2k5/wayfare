import {
  PROVIDER_OUTAGE_RETRY_WINDOW_MS,
  SYNTHESIS_TASK_ATTEMPTS,
  SynthesisFailureReason,
} from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { attemptOutcome } from './attempt-outcome';
import type { FailedAttempt } from './attempt-outcome';

const now = new Date('2026-10-15T14:50:00Z');
const failed = (over: Partial<FailedAttempt> = {}): FailedAttempt => ({
  attempts: 0,
  providerWaits: 0,
  providerDownSince: null,
  refused: false,
  providerUnavailable: false,
  now,
  ...over,
});

describe('a failed attempt', () => {
  it('spends an attempt and waits the usual back-off', () => {
    expect(attemptOutcome(failed())).toMatchObject({ final: false, attempts: 1, delayMs: 5_000 });
    expect(attemptOutcome(failed({ attempts: 1 }))).toMatchObject({
      final: false,
      delayMs: 30_000,
    });
    expect(attemptOutcome(failed({ attempts: SYNTHESIS_TASK_ATTEMPTS - 1 }))).toMatchObject({
      final: true,
    });
  });

  it('a refused input fails at once', () => {
    expect(attemptOutcome(failed({ refused: true }))).toMatchObject({ final: true, attempts: 1 });
  });

  it('no reachable provider spends no attempt, on the outage back-off', () => {
    const first = attemptOutcome(failed({ providerUnavailable: true }));
    expect(first).toEqual({
      final: false,
      attempts: 1,
      providerWaits: 1,
      providerDownSince: now,
      failureReason: SynthesisFailureReason.PROVIDER_UNAVAILABLE,
      delayMs: 60_000,
    });
    const waits = [2, 3, 40].map(
      (n) =>
        attemptOutcome(
          failed({ attempts: n - 1, providerWaits: n - 1, providerUnavailable: true }),
        ) as { delayMs: number },
    );
    expect(waits.map((w) => w.delayMs)).toEqual([300_000, 900_000, 900_000]);
  });

  it('after an outage, the attempts it took are not counted', () => {
    // Two waits, then two ordinary failures: the second is the task's second counted attempt.
    const outcome = attemptOutcome(failed({ attempts: 3, providerWaits: 2 }));
    expect(outcome).toMatchObject({ final: false, attempts: 4, providerDownSince: null });
  });

  it('fails for good once the outage has lasted the whole window', () => {
    const since = new Date(now.getTime() - PROVIDER_OUTAGE_RETRY_WINDOW_MS);
    const ongoing = { providerUnavailable: true, providerWaits: 98, attempts: 98 };
    expect(attemptOutcome(failed({ ...ongoing, providerDownSince: since }))).toMatchObject({
      final: true,
    });
    const justInside = new Date(since.getTime() + 1);
    expect(attemptOutcome(failed({ ...ongoing, providerDownSince: justInside }))).toMatchObject({
      final: false,
      providerDownSince: justInside,
    });
  });
});
