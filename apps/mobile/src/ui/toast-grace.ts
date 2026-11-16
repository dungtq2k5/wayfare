/**
 * How long a control that has just appeared where another was ignores taps: a tap that soon is the
 * same gesture's second tap, not a choice. A toast's action keeps it from the moment the toast
 * appears; *Start walk* from the moment *Stop* was pressed. A time for input, not a duration token:
 * it does not shrink when the system removes animations (conventions §12.6).
 */
export const TOAST_ACTION_GRACE_MS = 400;

/** Whether a press on a toast's action at `now` acts, for a toast shown at `shownAt`. */
export function actionAccepted(shownAt: number, now: number): boolean {
  return now - shownAt >= TOAST_ACTION_GRACE_MS;
}
