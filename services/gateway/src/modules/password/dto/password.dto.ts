import {
  changePasswordBodySchema,
  MAX_REFRESH_TOKEN_LENGTH,
  resetPasswordBodySchema,
  zEmail,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /auth/password/forgot` body (api-endpoints-plan §1.2). */
export const forgotPasswordBodySchema = z.object({ email: zEmail }).strict();

/** Validated `POST /auth/password/forgot` body. */
export class ForgotPasswordDto extends createZodDto(forgotPasswordBodySchema) {}

/** An emailed link's token, always in a body — never a path or a query string. */
export const linkTokenBodySchema = z
  .object({ token: z.string().min(1).max(MAX_REFRESH_TOKEN_LENGTH) })
  .strict();

/** Validated `{ token }` body. */
export class LinkTokenDto extends createZodDto(linkTokenBodySchema) {}

/** Validated `POST /auth/password/reset` body. */
export class ResetPasswordDto extends createZodDto(resetPasswordBodySchema) {}

/** Validated `PATCH /auth/password` body. */
export class ChangePasswordDto extends createZodDto(changePasswordBodySchema) {}
