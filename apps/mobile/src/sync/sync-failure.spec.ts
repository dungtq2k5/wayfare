import { describe, expect, it } from 'vitest';
import { syncFailureShown } from './sync-failure';

describe('the sync-failure line (K5)', () => {
  it('shows with an error, online, nothing local', () => {
    expect(syncFailureShown('Couldn’t reach Wayfare', false, true)).toBe(true);
  });

  it('stays quiet with local data, or with no error', () => {
    expect(syncFailureShown('Couldn’t reach Wayfare', false, false)).toBe(false);
    expect(syncFailureShown(null, false, true)).toBe(false);
  });

  it('offline, leaves it to the offline note', () => {
    expect(syncFailureShown('Couldn’t reach Wayfare', true, true)).toBe(false);
  });
});
