import { EmailDeliveryStatus } from './types';

/** The forward order of the non-terminal statuses (rdm-spec I-13). */
export const EMAIL_STATUS_RANK: Readonly<Partial<Record<EmailDeliveryStatus, number>>> = {
  [EmailDeliveryStatus.QUEUED]: 0,
  [EmailDeliveryStatus.SENT]: 1,
  [EmailDeliveryStatus.DELIVERED]: 2,
  [EmailDeliveryStatus.COMPLAINED]: 3,
};

/** Statuses nothing moves on from. */
export const EMAIL_TERMINAL_STATUSES: ReadonlySet<EmailDeliveryStatus> = new Set([
  EmailDeliveryStatus.BOUNCED,
  EmailDeliveryStatus.FAILED,
]);

/**
 * The status a delivery moves to, or `null` when the update must not apply (rdm-spec I-13): only
 * forward by rank, or into a terminal status from a non-terminal one — so a late `DELIVERED`
 * never overwrites `BOUNCED`.
 */
export function advanceDeliveryStatus(
  current: EmailDeliveryStatus,
  next: EmailDeliveryStatus,
): EmailDeliveryStatus | null {
  if (EMAIL_TERMINAL_STATUSES.has(current)) return null;
  if (EMAIL_TERMINAL_STATUSES.has(next)) return next;
  const from = EMAIL_STATUS_RANK[current] ?? 0;
  const to = EMAIL_STATUS_RANK[next] ?? 0;
  return to > from ? next : null;
}
