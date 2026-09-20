import { z } from 'zod';
import { AudioStatus } from '../catalog/enums';
import { MAX_DESCRIPTION_CHARS, MAX_PLACE_NAME_LENGTH } from '../catalog/limits';
import { zUuidV7 } from '../common/ids';
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
    lang: z.string(),
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
    lang: z.string(),
    /** The text served now, machine or human. */
    name: z.string(),
    description: z.string().nullable(),
    translationSource: z.enum(TranslationSource),
    audioStatus: z.enum(AudioStatus),
    /** The correction held for this language, whether or not it is in use. */
    correction: zCorrection.nullable(),
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
