import { exactlyOneProof, itsYouFields, MAX_FULL_NAME_LENGTH, zLanguage } from '@wayfare/contracts';
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

/**
 * `DELETE /users/me` body: the current password — or, for a Google-only account, a Google
 * confirmation — and the word itself (api-endpoints-plan §1.3).
 */
export const eraseMeBodySchema = z
  .object({ ...itsYouFields, confirm: z.literal('DELETE') })
  .strict()
  .refine(exactlyOneProof, {
    message: 'Exactly one of currentPassword and confirmation',
    path: ['currentPassword'],
  });

/** Validated `DELETE /users/me` body. */
export class EraseMeDto extends createZodDto(eraseMeBodySchema) {}

/** `DELETE /users/me/identities/google` body: the current password or a Google confirmation. */
export const unlinkGoogleBodySchema = z
  .object(itsYouFields)
  .strict()
  .refine(exactlyOneProof, {
    message: 'Exactly one of currentPassword and confirmation',
    path: ['currentPassword'],
  });

/** Validated `DELETE /users/me/identities/google` body. */
export class UnlinkGoogleDto extends createZodDto(unlinkGoogleBodySchema) {}
