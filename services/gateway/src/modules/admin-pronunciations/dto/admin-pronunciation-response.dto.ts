import { zPronunciationEntry } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A dictionary entry. */
export class PronunciationEntryResponseDto extends createZodDto(zPronunciationEntry) {}

/** `{ entry }`, as the dictionary writes return it. */
export const pronunciationResultResponseSchema = z.object({ entry: zPronunciationEntry }).strict();

/** What a dictionary write returns under `data`. */
export class PronunciationResultResponseDto extends createZodDto(
  pronunciationResultResponseSchema,
) {}
