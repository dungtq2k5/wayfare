import { z } from 'zod';
import { MAX_OFFER_TEXT_LENGTH, MAX_OFFER_TITLE_LENGTH } from '../billing/limits';
import {
  MAX_MENU_ITEM_DESCRIPTION_LENGTH,
  MAX_MENU_ITEM_NAME_LENGTH,
  MAX_PLACE_NAME_LENGTH,
  MAX_TOUR_TITLE_LENGTH,
} from '../catalog/limits';
import { zUuidV7 } from '../common/ids';
import { zLanguage } from '../common/languages';
import {
  LocalizationTargetType,
  MAX_FAILURE_REASON_LENGTH,
  SynthesisStage,
  TranslationSource,
} from '../narration/enums';
import { defineEvent, eventSchema, zSha256Hex } from './event-definition';

/** Upper bound of a localized long text — a translation may run longer than its 4000-character source. */
export const MAX_LOCALIZED_TEXT_LENGTH = 16_000;

/** Upper bound of an audio object's storage path. */
export const MAX_OBJECT_PATH_LENGTH = 512;

/** The targets whose localizations other services store. */
export const LOCALIZED_TARGET_TYPES = [
  LocalizationTargetType.PLACE,
  LocalizationTargetType.MENU_ITEM,
  LocalizationTargetType.TOUR,
  LocalizationTargetType.VOUCHER_OFFER,
] as const;

const longText = z.string().min(1).max(MAX_LOCALIZED_TEXT_LENGTH);

/** Each target type's localized text (rdm-spec C-4, C-7, C-9, B-8). */
export const LOCALIZED_TEXT = {
  [LocalizationTargetType.PLACE]: z
    .object({ name: z.string().min(1).max(MAX_PLACE_NAME_LENGTH), description: longText })
    .strict(),
  [LocalizationTargetType.MENU_ITEM]: z
    .object({
      name: z.string().min(1).max(MAX_MENU_ITEM_NAME_LENGTH),
      description: z.string().min(1).max(MAX_MENU_ITEM_DESCRIPTION_LENGTH).optional(),
    })
    .strict(),
  [LocalizationTargetType.TOUR]: z
    .object({ title: z.string().min(1).max(MAX_TOUR_TITLE_LENGTH), description: longText })
    .strict(),
  [LocalizationTargetType.VOUCHER_OFFER]: z
    .object({
      title: z.string().min(1).max(MAX_OFFER_TITLE_LENGTH),
      description: z.string().min(1).max(MAX_OFFER_TEXT_LENGTH),
      terms: z.string().min(1).max(MAX_OFFER_TEXT_LENGTH).optional(),
    })
    .strict(),
} as const satisfies Record<(typeof LOCALIZED_TARGET_TYPES)[number], z.ZodType>;

/** A synthesized narration, as catalog stores it on C-4. */
export const zNarrationAudio = z
  .object({
    assetId: zUuidV7,
    objectPath: z.string().min(1).max(MAX_OBJECT_PATH_LENGTH),
    sha256: zSha256Hex,
    bytes: z.number().int().min(1),
    durationMs: z.number().int().min(1),
    voiceId: z.string().min(1).max(64),
    sourceContentHash: zSha256Hex,
  })
  .strict();

/** `narration.localization.ready` — a target's text (and, for a Place, audio) is ready. */
export const NARRATION_LOCALIZATION_READY = defineEvent({
  subject: 'narration.localization.ready',
  publisher: 'narration',
  stream: 'NARRATION',
  schema: eventSchema({
    targetType: z.enum(LOCALIZED_TARGET_TYPES),
    targetId: zUuidV7,
    lang: zLanguage,
    sourceContentHash: zSha256Hex,
    translationSource: z.enum(TranslationSource),
    text: z.union(Object.values(LOCALIZED_TEXT)),
    audio: zNarrationAudio.optional(),
  }).superRefine((payload, ctx) => {
    // `text` must be the shape of its own target type, not merely one of the four.
    if (!LOCALIZED_TEXT[payload.targetType].safeParse(payload.text).success) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: `Not a ${payload.targetType} text` });
    }
    if (payload.audio !== undefined && payload.targetType !== LocalizationTargetType.PLACE) {
      ctx.addIssue({ code: 'custom', path: ['audio'], message: 'Only a PLACE has audio' });
    }
    if (
      payload.targetType === LocalizationTargetType.VOUCHER_OFFER &&
      payload.translationSource === TranslationSource.HUMAN
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['translationSource'],
        message: 'A voucher offer is never HUMAN',
      });
    }
    // A human correction of a Place re-voices it: text and audio arrive together.
    if (
      payload.targetType === LocalizationTargetType.PLACE &&
      payload.translationSource === TranslationSource.HUMAN &&
      payload.audio === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['audio'],
        message: 'A HUMAN Place localization carries its audio',
      });
    }
  }),
  aggregateId: (payload) => payload.targetId,
});

/** `narration.localization.failed` — a localization step failed; `final` on the last permitted retry. */
export const NARRATION_LOCALIZATION_FAILED = defineEvent({
  subject: 'narration.localization.failed',
  publisher: 'narration',
  stream: 'NARRATION',
  schema: eventSchema({
    targetType: z.enum(LOCALIZED_TARGET_TYPES),
    targetId: zUuidV7,
    lang: zLanguage,
    stage: z.enum(SynthesisStage),
    reason: z.string().min(1).max(MAX_FAILURE_REASON_LENGTH),
    final: z.boolean(),
  }),
  aggregateId: (payload) => payload.targetId,
});
