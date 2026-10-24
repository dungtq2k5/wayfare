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
