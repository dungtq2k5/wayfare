import { MAX_FULL_NAME_LENGTH, MAX_PASSWORD_LENGTH, zLanguage } from '@wayfare/contracts';
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

/** `DELETE /users/me` body: the current password and the word itself (api-endpoints-plan §1.3). */
export const eraseMeBodySchema = z
  .object({
    currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
    confirm: z.literal('DELETE'),
  })
  .strict();

/** Validated `DELETE /users/me` body. */
export class EraseMeDto extends createZodDto(eraseMeBodySchema) {}
