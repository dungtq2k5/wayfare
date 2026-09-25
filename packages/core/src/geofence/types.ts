import type { NARRATION_CONFIG, PlaceSyncRecord } from '@wayfare/contracts';

/** What the geofence engine needs of a Place — never `discoveryBoost` (ADR 0007: boost belongs to pull surfaces only). */
export type GeofencePlace = Pick<
  PlaceSyncRecord,
  'id' | 'kind' | 'location' | 'triggerRadiusM' | 'narrationPriority' | 'autoNarrationEnabled'
>;

/** A single accepted location sample. */
export interface LocationFix {
  readonly t: number;
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number;
}

/** The `NARRATION_CONFIG` entries the engine reads, passed in so a test can vary them. */
export type GeofenceConfig = Pick<
  typeof NARRATION_CONFIG,
  | 'geofenceDebounceMs'
  | 'narrationCooldownMs'
  | 'commercialNarrationWindowMs'
  | 'commercialNarrationsPerWindow'
  | 'safetyReconcileIntervalMs'
  | 'locateMaxAccuracyM'
  | 'gpsGapMs'
>;

/** A Place currently a candidate or confirmed. */
export interface GeofenceEntry {
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly confirmed: boolean;
}

/** Serializable, persisted by the app so a killed background task resumes (conventions §12.3). */
export interface GeofenceState {
  readonly entries: Readonly<Record<string, GeofenceEntry>>;
  readonly lastFiredAt: Readonly<Record<string, number>>;
  readonly venueDecisionsAt: readonly number[];
  readonly lastFix: LocationFix | null;
}

export interface NarrationDecision {
  readonly placeId: string;
}
