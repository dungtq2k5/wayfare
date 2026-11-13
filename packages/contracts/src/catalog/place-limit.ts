import { PlaceStatus } from './enums';

/**
 * The statuses a Venue counts against its owner's `max_places` in (rdm-spec C-1): `INACTIVE` does
 * not count. One list for the downgrade, the reactivation room, `CountOwnerPlaces` and the create
 * refusal (`PLACE_LIMIT_REACHED`). "Newest" among them is by `created_at`.
 */
export const PLACE_LIMIT_STATUSES = [
  PlaceStatus.DRAFT,
  PlaceStatus.PROCESSING,
  PlaceStatus.ACTIVE,
] as const;
