import { exactlyOneProof, itsYouFields, updateMeBodySchema } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

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
