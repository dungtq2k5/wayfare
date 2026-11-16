/**
 * A text holding this fails the fake speech provider, and only that text: a test makes one
 * Place's narration fail while every other Place's keeps working. The fakes never run in
 * production (`env.schema.ts`).
 */
export const FAKE_SPEECH_FAILS_MARKER = '[fake:speech-fails]';

/** How a fake provider answers (local and test only): normally, failing, or out of reach. */
export type FakeFailure = boolean | 'unreachable';

/**
 * The error a failing fake rejects with. `unreachable` carries a network code, so the provider
 * chain treats it as an outage (rdm-spec N-2): a task waits for it without spending an attempt.
 */
export function fakeFailureError(
  role: 'speech' | 'translation',
  failing: FakeFailure,
): Error | null {
  if (failing === false) return null;
  if (failing === true) return new Error(`fake ${role} failure`);
  return Object.assign(new Error(`connect ECONNREFUSED (fake ${role} provider)`), {
    code: 'ECONNREFUSED',
  });
}
