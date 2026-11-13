import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { zCursorQuery, zPageQuery } from '../common/pagination';
import { MAX_MENU_ITEMS_PER_PLACE, MAX_PHOTOS_PER_PLACE } from '../entitlements/ceilings';
import { NarrationLanguageScope } from '../entitlements/entitlements';
import { zSha256Hex } from '../events/event-definition';
import { MenuCurrency } from '../money/display-price';
import { normalizeText } from '../common/text';
import {
  MAX_TRIGGER_RADIUS_M,
  MIN_TRIGGER_RADIUS_M,
  NARRATION_PRIORITY_MAX,
  NARRATION_PRIORITY_MIN,
} from '../narration/narration-config';
import { SubmissionKind, SubmissionStatus } from './enums';
import { SUBMISSION_EDITABLE_FIELDS } from './submission-fields';
import { MAX_DECISION_NOTE_LENGTH, MAX_SUBMISSION_INTERNAL_NOTE_LENGTH } from './limits';
import {
  checkMenuPrices,
  zCategoryCode,
  zMenuItemInput,
  zOpeningHours,
  zPhotoSetItem,
  zPlaceContentInput,
} from './schemas';

/** The `PlaceSubmissionPayload` version this build writes (rdm-spec C-11, §2.5). */
export const PLACE_SUBMISSION_PAYLOAD_VERSION = 1;

const content = zPlaceContentInput.shape;
const menuItem = zMenuItemInput.shape;

/** One photo of the desired set; its alt text is stated, `null` for none. */
export const zSubmissionPhoto = z
  .object({
    photoId: zUuidV7.optional(),
    uploadId: zUuidV7.optional(),
    altTextVi: zPhotoSetItem.shape.altTextVi.unwrap(),
  })
  .strict()
  .refine((item) => (item.photoId === undefined) !== (item.uploadId === undefined), {
    message: 'Exactly one of photoId and uploadId',
    path: ['photoId'],
  });

/** One menu line of the desired menu, every optional field stated. */
export const zSubmissionMenuItem = zMenuItemInput
  .extend({
    descriptionVi: menuItem.descriptionVi.unwrap(),
    priceMinor: menuItem.priceMinor.unwrap(),
    isAvailable: z.boolean(),
  })
  .strict();

/** The desired menu: one currency (ADR 0046). */
export const zSubmissionMenu = z
  .object({
    menuCurrency: z.enum(MenuCurrency),
    items: z.array(zSubmissionMenuItem).max(MAX_MENU_ITEMS_PER_PLACE),
  })
  .strict()
  .superRefine(checkMenuPrices);

/**
 * `PlaceSubmissionPayload` version 1 (rdm-spec C-11): a Venue's complete desired state. Every
 * optional field is stated — `null` clears, and nothing absent can mean "unchanged". **No
 * `narrationPriority` and no `triggerRadiusM`** (rdm-spec §1.4): strictness refuses them.
 */
export const zPlaceSubmissionPayload = z
  .object({
    nameVi: content.nameVi,
    descriptionVi: content.descriptionVi,
    categoryCode: content.categoryCode,
    location: content.location,
    addressVi: content.addressVi.unwrap(),
    priceBand: content.priceBand.unwrap(),
    phone: content.phone.unwrap(),
    websiteUrl: content.websiteUrl.unwrap(),
    openingHours: zOpeningHours,
    photos: z.array(zSubmissionPhoto).max(MAX_PHOTOS_PER_PLACE),
    menu: zSubmissionMenu,
  })
  .strict()
  .superRefine((payload, ctx) => {
    const seen = new Set<string>();
    payload.photos.forEach((photo, index) => {
      const id = photo.photoId ?? photo.uploadId;
      if (id === undefined) return;
      if (seen.has(id)) {
        ctx.addIssue({ code: 'custom', path: ['photos', index], message: 'Listed twice' });
      }
      seen.add(id);
    });
  });
/** A validated submission payload. */
export type PlaceSubmissionPayload = z.output<typeof zPlaceSubmissionPayload>;

/**
 * `POST /owner/submissions` (api-endpoints-plan §3.3): `placeId` and `baseEditableHash` are
 * required for an `UPDATE` and refused for a `CREATE`.
 */
export const zSubmissionCreateInput = z
  .object({
    kind: z.enum(SubmissionKind),
    placeId: zUuidV7.optional(),
    baseEditableHash: zSha256Hex.optional(),
    payload: zPlaceSubmissionPayload,
  })
  .strict()
  .superRefine((input, ctx) => {
    const update = input.kind === SubmissionKind.UPDATE;
    for (const key of ['placeId', 'baseEditableHash'] as const) {
      if (update === (input[key] === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: update ? 'Required for an UPDATE' : 'Not allowed for a CREATE',
        });
      }
    }
  });

/** `GET /owner/submissions` (api-endpoints-plan §3.3), cursor style. */
export const zOwnerSubmissionsQuery = zCursorQuery
  .extend({
    placeId: zUuidV7.optional(),
    status: z.enum(SubmissionStatus).optional(),
  })
  .strict();

/** `GET /admin/submissions` (api-endpoints-plan §3.4): page style, oldest first. */
export const zSubmissionQueueQuery = zPageQuery({
  sort: ['submittedAt'],
  defaultSort: 'submittedAt',
})
  .omit({ sort: true })
  .extend({
    status: z.enum(SubmissionStatus).default(SubmissionStatus.PENDING),
    kind: z.enum(SubmissionKind).optional(),
    areaId: zUuidV7.optional(),
  })
  .strict();

const zNote = (max: number) => z.string().transform(normalizeText).pipe(z.string().min(1).max(max));

/** `POST /admin/submissions/:id/approve`: the editorial values come from the reviewer. */
export const zApproveSubmissionInput = z
  .object({
    triggerRadiusM: z.number().int().min(MIN_TRIGGER_RADIUS_M).max(MAX_TRIGGER_RADIUS_M),
    narrationPriority: z.number().int().min(NARRATION_PRIORITY_MIN).max(NARRATION_PRIORITY_MAX),
    categoryCodeOverride: zCategoryCode.optional(),
    decisionNote: zNote(MAX_DECISION_NOTE_LENGTH).optional(),
    internalNote: zNote(MAX_SUBMISSION_INTERNAL_NOTE_LENGTH).optional(),
    acknowledgeConflict: z.boolean().default(false),
  })
  .strict();

/** `POST /admin/submissions/:id/reject`: the owner is always told why. */
export const zRejectSubmissionInput = z
  .object({
    decisionNote: zNote(MAX_DECISION_NOTE_LENGTH),
    internalNote: zNote(MAX_SUBMISSION_INTERNAL_NOTE_LENGTH).optional(),
  })
  .strict();

/** One field of a reviewer's diff: what it was and what the submission asks for. */
export const zSubmissionDiffEntry = z
  .object({
    field: z.enum(SUBMISSION_EDITABLE_FIELDS),
    before: z.unknown(),
    after: z.unknown(),
  })
  .strict();
/** One diff entry. */
export type SubmissionDiffEntry = z.output<typeof zSubmissionDiffEntry>;

/** `GET /owner/places/limits` (api-endpoints-plan §3.1): the effective values. */
export const zOwnerLimits = z
  .object({
    maxPlaces: z.number().int().min(0),
    used: z.number().int().min(0),
    reservedByPendingSubmissions: z.number().int().min(0),
    maxPhotosPerPlace: z.number().int().min(0),
    maxMenuItemsPerPlace: z.number().int().min(0),
    narrationLanguageScope: z.enum(NarrationLanguageScope),
    autoNarration: z.boolean(),
  })
  .strict();
/** An owner's limits. */
export type OwnerLimits = z.output<typeof zOwnerLimits>;
