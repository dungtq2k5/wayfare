import { PlaceStatus } from '@wayfare/contracts';

/**
 * The advisory lock every area write holds exclusively, and every Place write that looks up or
 * checks its area holds shared (rdm-spec C-3): the two never interleave.
 */
export const AREAS_LOCK_KEY = 'catalog:areas';

/** The statuses that keep an area from being deactivated (rdm-spec C-3). */
export const LIVE_PLACE_STATUSES: readonly PlaceStatus[] = [
  PlaceStatus.PROCESSING,
  PlaceStatus.ACTIVE,
];

/** How many excluded Place ids `AREA_EXCLUDES_PLACES` names; its count is complete. */
export const EXCLUDED_PLACE_IDS_SHOWN = 20;
