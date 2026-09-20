import { z } from 'zod';
import { zCursorQuery } from '../common/pagination';
import { zUuidV7 } from '../common/ids';
import { zLanguage, zRequestedLanguage } from '../common/languages';
import { ReplacementType } from './enums';
import { MAX_PREVIEW_CHARS, MAX_PRONUNCIATION_TERM_LENGTH } from './limits';

/** The alphabets a `PHONEME` entry may name (rdm-spec N-5). */
export const PHONEME_ALPHABETS = ['ipa', 'x-sampa'] as const;

/** A pronunciation entry's term: the Vietnamese proper noun as written, with its diacritics. */
export const zPronunciationTerm = z
  .string()
  .trim()
  .min(2)
  .max(MAX_PRONUNCIATION_TERM_LENGTH)
  .normalize('NFC');

const entryFields = {
  term: zPronunciationTerm,
  /** Absent or null: every non-`vi` language (rdm-spec N-5). */
  targetLang: zLanguage.nullable().optional(),
  replacementType: z.enum(ReplacementType),
  replacement: z.string().trim().min(1).max(255),
  alphabet: z.enum(PHONEME_ALPHABETS).nullable().optional(),
  note: z.string().trim().max(255).nullable().optional(),
  isActive: z.boolean().optional(),
};

/** `PHONEME` carries an alphabet, `SUB` never does (rdm-spec N-5's `pronunciation_alphabet_ck`). */
const phonemeHasAlphabet = <T extends { replacementType?: ReplacementType; alphabet?: unknown }>(
  input: T,
  ctx: z.RefinementCtx,
): void => {
  if (input.replacementType === undefined) return;
  const hasAlphabet = input.alphabet !== undefined && input.alphabet !== null;
  if ((input.replacementType === ReplacementType.PHONEME) !== hasAlphabet) {
    ctx.addIssue({
      code: 'custom',
      path: ['alphabet'],
      message: 'A PHONEME entry names an alphabet; a SUB entry does not',
    });
  }
};

/** `POST /admin/narration/pronunciations` body (api-endpoints-plan §4.4). */
export const zPronunciationInput = z.object(entryFields).strict().superRefine(phonemeHasAlphabet);
/** A validated new entry. */
export type PronunciationInput = z.output<typeof zPronunciationInput>;

/** `PATCH /admin/narration/pronunciations/:id` body: never the term or its language. */
export const zPronunciationUpdateInput = z
  .object({
    replacementType: entryFields.replacementType.optional(),
    replacement: entryFields.replacement.optional(),
    alphabet: entryFields.alphabet,
    note: entryFields.note,
    isActive: entryFields.isActive,
  })
  .strict()
  .superRefine(phonemeHasAlphabet);
/** A validated entry edit. */
export type PronunciationUpdateInput = z.output<typeof zPronunciationUpdateInput>;

/** A dictionary entry as the console lists it. */
export const zPronunciationEntry = z
  .object({
    id: zUuidV7,
    term: z.string(),
    targetLang: z.string().nullable(),
    replacementType: z.enum(ReplacementType),
    replacement: z.string(),
    alphabet: z.string().nullable(),
    note: z.string().nullable(),
    isActive: z.boolean(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
/** A dictionary entry. */
export type PronunciationEntry = z.output<typeof zPronunciationEntry>;

/** `GET /admin/narration/pronunciations` query. */
export const zPronunciationQuery = zCursorQuery
  .extend({
    q: z.string().trim().min(1).max(MAX_PRONUNCIATION_TERM_LENGTH).optional(),
    targetLang: zLanguage.optional(),
  })
  .strict();

/** One entry a preview applies on top of the saved dictionary, saved or not. */
export const zPreviewEntry = z.object(entryFields).strict().superRefine(phonemeHasAlphabet);

/**
 * `POST /admin/narration/pronunciations/preview` body (api-endpoints-plan §4.4): how a sentence
 * sounds with the dictionary as it would be. Nothing is stored.
 */
export const zPreviewInput = z
  .object({
    text: z.string().trim().min(1).max(MAX_PREVIEW_CHARS),
    lang: zRequestedLanguage,
    entries: z.array(zPreviewEntry).max(20).optional(),
  })
  .strict();
/** A validated preview request. */
export type PreviewInput = z.output<typeof zPreviewInput>;
