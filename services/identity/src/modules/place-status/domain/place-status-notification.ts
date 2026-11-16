import { NotificationType, PlaceInactiveReason, PlaceStatus } from '@wayfare/contracts';
import type { CATALOG_PLACE_STATUS_CHANGED, EventPayload, Notification } from '@wayfare/contracts';

/**
 * The notification a Place's status change sends its owner, or null (api-endpoints-plan §10). Only
 * a Venue's owner is told, and only of what they did not do themselves:
 *
 * - into `ACTIVE` on a first publication or back from `INACTIVE` → `PLACE_ACTIVATED`; a return to
 *   `ACTIVE` after an edit's `PROCESSING` is not news;
 * - into `INACTIVE` by an admin or the plan's limit → `PLACE_UNPUBLISHED { reason }`; the owner's
 *   own deactivation is not.
 *
 * A deletion or restore with no status change, and `DRAFT` / `PROCESSING` moves, notify no one.
 */
export function placeStatusNotification(
  event: EventPayload<typeof CATALOG_PLACE_STATUS_CHANGED>,
): Notification | null {
  if (event.ownerUserId === undefined || event.from === event.to) return null;
  if (event.to === PlaceStatus.ACTIVE) {
    return event.firstPublication || event.from === PlaceStatus.INACTIVE
      ? { type: NotificationType.PLACE_ACTIVATED, data: { placeId: event.placeId } }
      : null;
  }
  if (
    event.to === PlaceStatus.INACTIVE &&
    (event.reason === PlaceInactiveReason.ADMIN ||
      event.reason === PlaceInactiveReason.ENTITLEMENT_LIMIT)
  ) {
    return {
      type: NotificationType.PLACE_UNPUBLISHED,
      data: { placeId: event.placeId, reason: event.reason },
    };
  }
  return null;
}
