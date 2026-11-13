import { describe, expect, it } from 'vitest';
import { actionAccepted, TOAST_ACTION_GRACE_MS } from './toast-grace';

describe("a toast's action", () => {
  it('ignores a press inside the grace, and acts from its end', () => {
    expect(TOAST_ACTION_GRACE_MS).toBe(400);
    expect(actionAccepted(1_000, 1_000)).toBe(false);
    expect(actionAccepted(1_000, 1_399)).toBe(false);
    expect(actionAccepted(1_000, 1_400)).toBe(true);
  });
});
