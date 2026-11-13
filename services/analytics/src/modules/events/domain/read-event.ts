import { AnalyticsEventType, VOUCHERS_AVAILABLE, zAnalyticsEvent } from '@wayfare/contracts';
import type { AnalyticsEvent } from '@wayfare/contracts';

/** Why an event was dropped, for the batch's one log line — never its content. */
export type DropReason = 'malformed' | 'deferred';

/**
 * One event as the client sent it, read on its own: the event, or why it's dropped — a bad
 * `props`, a missing field, or a `VOUCHER_VIEWED` while vouchers aren't sold (ADR 0066).
 */
export function readEvent(
  json: string,
  vouchersAvailable = VOUCHERS_AVAILABLE,
): { event: AnalyticsEvent } | { dropped: DropReason } {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { dropped: 'malformed' };
  }
  const parsed = zAnalyticsEvent.safeParse(value);
  if (!parsed.success) return { dropped: 'malformed' };
  if (parsed.data.type === AnalyticsEventType.VOUCHER_VIEWED && !vouchersAvailable)
    return { dropped: 'deferred' };
  return { event: parsed.data };
}
