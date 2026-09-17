/** Who a Place belongs to — rdm-spec C-1 `kind`. */
export enum PlaceKind {
  EDITORIAL = 'EDITORIAL',
  VENUE = 'VENUE',
}

/** Every `PlaceKind` value. */
export const PLACE_KINDS = Object.values(PlaceKind);

/** A Place's lifecycle — rdm-spec C-1 `status`. */
export enum PlaceStatus {
  DRAFT = 'DRAFT',
  PROCESSING = 'PROCESSING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

/** Every `PlaceStatus` value. */
export const PLACE_STATUSES = Object.values(PlaceStatus);

/** Why a Place is inactive — rdm-spec C-1 `inactive_reason`. */
export enum PlaceInactiveReason {
  ADMIN = 'ADMIN',
  OWNER = 'OWNER',
  ENTITLEMENT_LIMIT = 'ENTITLEMENT_LIMIT',
}

/** Every `PlaceInactiveReason` value. */
export const PLACE_INACTIVE_REASONS = Object.values(PlaceInactiveReason);

/** Which Places a category may tag — rdm-spec C-2 `applies_to`. */
export enum CategoryAppliesTo {
  EDITORIAL = 'EDITORIAL',
  VENUE = 'VENUE',
  ANY = 'ANY',
}

/** Every `CategoryAppliesTo` value. */
export const CATEGORY_APPLIES_TO_VALUES = Object.values(CategoryAppliesTo);

/** A localization's audio state — rdm-spec C-4 `audio_status`. */
export enum AudioStatus {
  PENDING = 'PENDING',
  READY = 'READY',
  FAILED = 'FAILED',
}

/** Every `AudioStatus` value. */
export const AUDIO_STATUSES = Object.values(AudioStatus);

/** A Tour's lifecycle — rdm-spec C-8 `status`. */
export enum TourStatus {
  DRAFT = 'DRAFT',
  PROCESSING = 'PROCESSING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

/** Every `TourStatus` value. */
export const TOUR_STATUSES = Object.values(TourStatus);

/** What an owner submission proposes — rdm-spec C-11 `kind`. */
export enum SubmissionKind {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
}

/** Every `SubmissionKind` value. */
export const SUBMISSION_KINDS = Object.values(SubmissionKind);

/** Where an owner submission stands — rdm-spec C-11 `status`. */
export enum SubmissionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
  SUPERSEDED = 'SUPERSEDED',
}

/** Every `SubmissionStatus` value. */
export const SUBMISSION_STATUSES = Object.values(SubmissionStatus);

/** What an upload is for — rdm-spec C-12 `purpose`. */
export enum UploadPurpose {
  PLACE_PHOTO = 'PLACE_PHOTO',
  TOUR_COVER = 'TOUR_COVER',
}

/** Every `UploadPurpose` value. */
export const UPLOAD_PURPOSES = Object.values(UploadPurpose);

/** An offline map pack's lifecycle — rdm-spec C-14 `status`. */
export enum MapPackStatus {
  BUILDING = 'BUILDING',
  PUBLISHED = 'PUBLISHED',
  RETIRED = 'RETIRED',
}

/** Every `MapPackStatus` value. */
export const MAP_PACK_STATUSES = Object.values(MapPackStatus);
