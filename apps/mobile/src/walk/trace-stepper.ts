/**
 * One step of a simulated walk: feeds the trace from `cursor` until `feed` reports a decision, then
 * holds. Returns where the next step starts and whether this one reached a decision.
 */
export async function advanceToDecision<Fix>(
  trace: readonly Fix[],
  cursor: number,
  feed: (fix: Fix) => Promise<boolean>,
): Promise<{ cursor: number; decided: boolean }> {
  let at = cursor;
  while (at < trace.length) {
    const fix = trace[at]!;
    at += 1;
    if (await feed(fix)) return { cursor: at, decided: true };
  }
  return { cursor: at, decided: false };
}
