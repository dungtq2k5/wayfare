import { z } from 'zod';
import { AudioStatus } from '../catalog/enums';
import { MAX_DESCRIPTION_CHARS, MAX_PLACE_NAME_LENGTH } from '../catalog/limits';
import { zUuidV7 } from '../common/ids';
import { zCursorQuery } from '../common/pagination';
import { zServedLanguage } from '../common/languages';
import { zSha256Hex } from '../events/event-definition';
import { LocalizationTargetType, OverrideStatus, TranslationSource } from './enums';

/**
 * `PUT /admin/narration/localizations/:targetType/:targetId/:lang` body (api-endpoints-plan §4.5):
 * the corrected text, against the source version the editor was looking at.
 */
export const zCorrectionInput = z
  .object({
    sourceContentHash: zSha256Hex,
    name: z.string().trim().min(1).max(MAX_PLACE_NAME_LENGTH),
    description: z.string().trim().max(MAX_DESCRIPTION_CHARS).nullable().optional(),
  })
  .strict();
/** A validated correction. */
export type CorrectionInput = z.output<typeof zCorrectionInput>;

/** A staff correction of one language (rdm-spec N-7). */
export const zCorrection = z
  .object({
    id: zUuidV7,
    targetType: z.enum(LocalizationTargetType),
    targetId: zUuidV7,
    lang: zServedLanguage,
    sourceContentHash: zSha256Hex,
    name: z.string(),
    description: z.string().nullable(),
    status: z.enum(OverrideStatus),
    /** True when the target's text has moved on: the correction is kept but no longer used. */
    supersededByHash: z.boolean(),
    editedById: zUuidV7,
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
/** A correction. */
export type Correction = z.output<typeof zCorrection>;

/** One language on the correction screen (api-endpoints-plan §4.5). */
export const zLocalizationOverviewRow = z
  .object({
    lang: zServedLanguage,
    /** The text served now, machine or human. */
    name: z.string(),
    description: z.string().nullable(),
    translationSource: z.enum(TranslationSource),
    audioStatus: z.enum(AudioStatus),
    /**
     * The language's latest correction, whether or not it is in use: an active one, or one a
     * Vietnamese change superseded (a revert by nobody). A person's revert leaves none.
     */
    correction: zCorrection.nullable(),
    /** The correction no longer matches the Vietnamese: someone should look at it again. */
    needsReview: z.boolean(),
  })
  .strict();

/** `GET /admin/narration/localizations/:targetType/:targetId`. */
export const zLocalizationOverview = z
  .object({
    targetType: z.enum(LocalizationTargetType),
    targetId: zUuidV7,
    /** The source version everything here is measured against. */
    sourceContentHash: zSha256Hex,
    nameVi: z.string(),
    descriptionVi: z.string().nullable(),
    languages: z.array(zLocalizationOverviewRow),
  })
  .strict();
/** A correction screen. */
export type LocalizationOverview = z.output<typeof zLocalizationOverview>;

/** `GET /admin/narration/corrections` (api-endpoints-plan §4.5): which come first. */
export const CORRECTIONS_SHOW = ['REVIEW_FIRST', 'RECENT'] as const;

/** The corrections list's query: needing review first (the default), or newest first. */
export const zCorrectionsQuery = zCursorQuery
  .extend({ show: z.enum(CORRECTIONS_SHOW).default('REVIEW_FIRST') })
  .strict();
/** A validated corrections list query. */
export type CorrectionsQuery = z.output<typeof zCorrectionsQuery>;

/** One row of the corrections list: a language's latest correction across every target. */
export const zCorrectionListItem = z
  .object({
    correction: zCorrection,
    /** The target's Vietnamese name now; empty when the target is gone. */
    targetNameVi: z.string(),
    needsReview: z.boolean(),
    /** Who wrote it; `name` is `null` unless the caller may see names (api §0's rule). */
    editedBy: z.object({ id: zUuidV7, name: z.string().nullable() }).strict(),
  })
  .strict();
/** One row of the corrections list. */
export type CorrectionListItem = z.output<typeof zCorrectionListItem>;
