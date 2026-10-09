const MINUTE_MS = 60_000;

/** Smallest trigger radius an admin may set, in metres (rdm-spec C-1 CHECK). */
export const MIN_TRIGGER_RADIUS_M = 10;
/** Largest trigger radius an admin may set, in metres (rdm-spec C-1 CHECK). */
export const MAX_TRIGGER_RADIUS_M = 100;
/** A Place's trigger radius when none is set, in metres (product-overview §9, rdm-spec C-1). */
export const DEFAULT_TRIGGER_RADIUS_M = 30;

/** Lowest narration priority (rdm-spec C-1 CHECK). */
export const NARRATION_PRIORITY_MIN = 0;
/** Highest narration priority (rdm-spec C-1 CHECK). */
export const NARRATION_PRIORITY_MAX = 100;
/** A Place's narration priority when none is set (rdm-spec C-1). */
export const NARRATION_PRIORITY_DEFAULT = 50;

/** The client narration loop's tunables (product-overview §9, conventions §12.3). Never hard-coded in an app. */
export const NARRATION_CONFIG = {
  gpsThrottleMs: 5_000,
  geofenceDebounceMs: 3_000,
  defaultTriggerRadiusM: DEFAULT_TRIGGER_RADIUS_M,
  minTriggerRadiusM: MIN_TRIGGER_RADIUS_M,
  maxTriggerRadiusM: MAX_TRIGGER_RADIUS_M,
  narrationCooldownMs: 5 * MINUTE_MS,
  commercialNarrationWindowMs: 10 * MINUTE_MS,
  commercialNarrationsPerWindow: 1,
  safetyReconcileIntervalMs: 5_000,
  gpsGapMs: 15_000,
  prefetchBatchSize: 3,
  prefetchMinIntervalMs: 30_000,
  prefetchBackoffMs: [30_000, 60_000, 120_000],
  prefetchBackoffCapMs: 10 * MINUTE_MS,
  hotsetReadyThreshold: 3,
  locateBudgetMs: 15_000,
  locateMaxFixAgeMs: 30_000,
  locateMaxAccuracyM: 100,
  networkProbeTimeoutMs: 2_500,
  networkProbeMaxAttempts: 2,
  networkProbeWindowMs: 8_000,
  placeCacheTtlMs: 15 * MINUTE_MS,
  audioCacheFilesPerLanguage: 300,
  audioCacheMaxLanguages: 3,
  /** How long the player waits for on-demand audio before it streams instead (product §10, tier 1.5). */
  onDemandWaitMs: 5_000,
} as const;
