/** A device's analytics consent decision — rdm-spec A-1 `state`. */
export enum ConsentState {
  GRANTED = 'GRANTED',
  WITHDRAWN = 'WITHDRAWN',
}

/** Every `ConsentState` value. */
export const CONSENT_STATES = Object.values(ConsentState);

/** A consented analytics event — rdm-spec A-2 `event_type`. */
export enum AnalyticsEventType {
  NARRATION_STARTED = 'NARRATION_STARTED',
  NARRATION_COMPLETED = 'NARRATION_COMPLETED',
  NARRATION_ABANDONED = 'NARRATION_ABANDONED',
  PLACE_OPENED = 'PLACE_OPENED',
  QR_SCANNED = 'QR_SCANNED',
  LANGUAGE_SELECTED = 'LANGUAGE_SELECTED',
  PACK_INSTALLED = 'PACK_INSTALLED',
  SEARCH_PERFORMED = 'SEARCH_PERFORMED',
  TOUR_STARTED = 'TOUR_STARTED',
  VOUCHER_VIEWED = 'VOUCHER_VIEWED',
}

/** Every `AnalyticsEventType` value. */
export const ANALYTICS_EVENT_TYPES = Object.values(AnalyticsEventType);

/** What started a narration — rdm-spec A-2 `trigger`. */
export enum AnalyticsTrigger {
  GEOFENCE = 'GEOFENCE',
  TAP = 'TAP',
  QR = 'QR',
}

/** Every `AnalyticsTrigger` value. */
export const ANALYTICS_TRIGGERS = Object.values(AnalyticsTrigger);

/** Which content tier played — rdm-spec A-2 `audio_tier`. */
export enum AudioTier {
  T1 = 'T1',
  T1_5 = 'T1_5',
  T2 = 'T2',
  T3 = 'T3',
}

/** Every `AudioTier` value. */
export const AUDIO_TIERS = Object.values(AudioTier);
