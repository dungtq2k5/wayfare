import { NotificationType } from '@wayfare/contracts';
import type { Translator } from '../i18n/messages';

/** A notification as the feed and the socket carry it: ids and short values only (rdm-spec I-10). */
export interface FeedNotification {
  readonly id: string;
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly readAt: string | null;
  readonly createdAt: string;
}

/** What the text needs that the notification does not carry: the reader's own Place names. */
export interface NotificationContext {
  readonly placeName: (placeId: string) => string | undefined;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * A plan's name from its code (`GROWTH` → "Growth"). ponytail: the code title-cased; read billing's
 * plan catalogue when a plan's name stops being its code.
 */
const planName = (code: string): string =>
  code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * A notification's line in the reader's current language (K10): from its `type` and `data`, the
 * Place's name looked up, never stored — "your venue" when it is not one the reader has loaded.
 */
export function notificationText(
  notification: Pick<FeedNotification, 'type' | 'data'>,
  context: NotificationContext,
  { t, tDynamic }: Translator,
): string {
  const placeId = text(notification.data.placeId);
  const placeName =
    (placeId === undefined ? undefined : context.placeName(placeId)) ??
    t('notification.venueFallback');
  const plan = text(notification.data.planCode);
  // A lost boost says why the Venue left: closed by its owner, or off the map otherwise.
  const variant =
    notification.type === (NotificationType.BOOST_ENDED as string) &&
    notification.data.placeInactiveReason === 'OWNER'
      ? '.closed'
      : '';
  return tDynamic(`notification.${notification.type}${variant}`, {
    placeName,
    planName: plan === undefined ? t('notification.planFallback') : planName(plan),
  });
}

/** Where a click on a notification goes (handoff §6.4), from its type and data. */
export function notificationTarget(notification: Pick<FeedNotification, 'type' | 'data'>): string {
  const placeId = text(notification.data.placeId);
  switch (notification.type as NotificationType) {
    case NotificationType.OWNER_REGISTRATION_APPROVED:
    case NotificationType.OWNER_REGISTRATION_REJECTED:
      return '/owner/registration';
    // Each opens the record it is about, which carries the note and what to do (round 36's K18).
    case NotificationType.SUBMISSION_APPROVED:
    case NotificationType.SUBMISSION_REJECTED: {
      const submissionId = text(notification.data.submissionId);
      return submissionId === undefined
        ? '/owner/submissions'
        : `/owner/submissions/${submissionId}`;
    }
    case NotificationType.SUBSCRIPTION_ACTIVATED:
    case NotificationType.SUBSCRIPTION_PAYMENT_FAILED:
    case NotificationType.ENTITLEMENTS_REDUCED:
    case NotificationType.ENTITLEMENTS_RAISED:
    case NotificationType.BOOST_ENDED:
    case NotificationType.PAYOUT_ACCOUNT_ACTION_REQUIRED:
    case NotificationType.VOUCHER_CODE_GUESSING_SUSPECTED:
      return '/owner/billing';
    case NotificationType.ACCOUNT_RECOVERY_PENDING:
    case NotificationType.ACCOUNT_RECOVERY_COMPLETED:
      return '/account';
    default:
      return placeId === undefined ? '/owner/notifications' : `/owner/venues/${placeId}`;
  }
}

/** "Just now", "5 minutes ago", "Yesterday"… (C10). */
export function relativeTime(createdAt: string, now: Date, { t }: Translator): string {
  const minutes = Math.floor((now.getTime() - new Date(createdAt).getTime()) / 60_000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return days === 1 ? t('time.yesterday') : t('time.daysAgo', { count: days });
}

/** A notification's text as its two lines: its first sentence, and the rest. */
export function splitNotification(text: string): [string, string] {
  const end = text.search(/[.!?](\s|$)/);
  return end < 0 || end === text.length - 1
    ? [text, '']
    : [text.slice(0, end + 1), text.slice(end + 1).trim()];
}
