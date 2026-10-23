import { exactlyOneProof, itsYouFields, zEmail } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `POST /auth/email/change` body (api-endpoints-plan §1.2): the current password, or for a
 * Google-only account a Google confirmation.
 */
export const changeEmailBodySchema = z
  .object({ newEmail: zEmail, ...itsYouFields })
  .strict()
  .refine(exactlyOneProof, {
    message: 'Exactly one of currentPassword and confirmation',
    path: ['currentPassword'],
  });

/** Validated `POST /auth/email/change` body. */
export class ChangeEmailDto extends createZodDto(changeEmailBodySchema) {}
