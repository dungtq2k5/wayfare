import { MAX_PASSWORD_LENGTH, zEmail } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /auth/email/change` body (api-endpoints-plan §1.2). */
export const changeEmailBodySchema = z
  .object({
    newEmail: zEmail,
    currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  })
  .strict();

/** Validated `POST /auth/email/change` body. */
export class ChangeEmailDto extends createZodDto(changeEmailBodySchema) {}
