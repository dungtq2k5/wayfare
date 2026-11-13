/**
 * Which text a localized record carries (rdm-spec §1.5, conventions §11.2) — computed at read time,
 * never stored.
 */
export enum ContentTier {
  /** A row exists for the requested language. */
  REQUESTED = 'REQUESTED',
  /** Falling back to the `en` row. */
  ENGLISH = 'ENGLISH',
  /** Falling back to the Vietnamese source on the Place itself. */
  SOURCE = 'SOURCE',
}

/** Every `ContentTier` value. */
export const CONTENT_TIERS = Object.values(ContentTier);
