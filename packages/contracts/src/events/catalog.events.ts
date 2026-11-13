import { z } from 'zod';
import { PlaceInactiveReason, PlaceStatus } from '../catalog/enums';
import { zUuidV7 } from '../common/ids';
import { zLanguage } from '../common/languages';
import { MAX_MENU_ITEMS_PER_PLACE } from '../entitlements/ceilings';
import { MAX_LANGS_PER_EVENT, SynthesisTrigger } from '../narration/enums';
import { zDecisionNote } from '../notifications/data';
import { zReviewDecision } from '../notifications/email-templates';
import { defineEvent, eventSchema, zSha256Hex } from './event-definition';

const zLangs = z.array(zLanguage).min(1).max(MAX_LANGS_PER_EVENT);

/** The triggers catalog itself can cause. */
export const CATALOG_SYNTHESIS_TRIGGERS = [
  SynthesisTrigger.APPROVAL,
  SynthesisTrigger.CONTENT_CHANGED,
  SynthesisTrigger.ENTITLEMENT_EXPANDED,
] as const;

/** `catalog.place.content_changed` — a Place's source text changed; narration re-localizes it. */
export const CATALOG_PLACE_CONTENT_CHANGED = defineEvent({
  subject: 'catalog.place.content_changed',
  publisher: 'catalog',
  stream: 'CATALOG',
  schema: eventSchema({
    placeId: zUuidV7,
    contentHash: zSha256Hex,
    langs: zLangs,
    trigger: z.enum(CATALOG_SYNTHESIS_TRIGGERS),
  }),
  aggregateId: (payload) => payload.placeId,
});

/** `catalog.menu.content_changed` — menu items changed; narration translates their text. */
export const CATALOG_MENU_CONTENT_CHANGED = defineEvent({
  subject: 'catalog.menu.content_changed',
  publisher: 'catalog',
  stream: 'CATALOG',
  schema: eventSchema({
    placeId: zUuidV7,
    menuItemIds: z.array(zUuidV7).min(1).max(MAX_MENU_ITEMS_PER_PLACE),
    langs: zLangs,
  }),
  aggregateId: (payload) => payload.placeId,
});

/** `catalog.tour.content_changed` — a Tour's source text changed. */
export const CATALOG_TOUR_CONTENT_CHANGED = defineEvent({
  subject: 'catalog.tour.content_changed',
  publisher: 'catalog',
  stream: 'CATALOG',
  schema: eventSchema({ tourId: zUuidV7, contentHash: zSha256Hex, langs: zLangs }),
  aggregateId: (payload) => payload.tourId,
});

/**
 * `catalog.place.status_changed` — a Place's tourist visibility changed: one event per transaction,
 * carrying the net change. `deleted` changes on a soft delete or restore, even when the status does not.
 */
export const CATALOG_PLACE_STATUS_CHANGED = defineEvent({
  subject: 'catalog.place.status_changed',
  publisher: 'catalog',
  stream: 'CATALOG',
  schema: eventSchema({
    placeId: zUuidV7,
    from: z.enum(PlaceStatus),
    to: z.enum(PlaceStatus),
    reason: z.enum(PlaceInactiveReason).nullable(),
    deleted: z.boolean(),
    ownerUserId: zUuidV7.optional(),
    /** This transaction set `published_at`: the Place's first publication, not a return after an edit. */
    firstPublication: z.boolean(),
  }),
  aggregateId: (payload) => payload.placeId,
});

/** `catalog.submission.reviewed` — an owner submission was approved or rejected. */
export const CATALOG_SUBMISSION_REVIEWED = defineEvent({
  subject: 'catalog.submission.reviewed',
  publisher: 'catalog',
  stream: 'CATALOG',
  schema: eventSchema({
    submissionId: zUuidV7,
    placeId: zUuidV7.optional(),
    ownerUserId: zUuidV7,
    decision: zReviewDecision,
    decisionNote: zDecisionNote.optional(),
  }),
  aggregateId: (payload) => payload.submissionId,
});
