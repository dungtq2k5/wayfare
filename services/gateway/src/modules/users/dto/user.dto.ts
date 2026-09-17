import { MAX_FULL_NAME_LENGTH, zLanguage } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `PATCH /users/me` body — the name and the UI language only; nothing is defaulted. */
export const updateMeBodySchema = z
  .object({
    fullName: z.string().trim().min(1).max(MAX_FULL_NAME_LENGTH).optional(),
    preferredLocale: zLanguage.optional(),
  })
  .strict();

/** Validated `PATCH /users/me` body. */
export class UpdateMeDto extends createZodDto(updateMeBodySchema) {}
