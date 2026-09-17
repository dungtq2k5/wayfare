import {
  MAX_PASSWORD_LENGTH,
  MAX_REFRESH_TOKEN_LENGTH,
  MIN_PASSWORD_LENGTH,
  zEmail,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const zNewPassword = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

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

/** `POST /auth/password/reset` body: a reset or setup link, and the new password. */
export const resetPasswordBodySchema = z
  .object({
    token: z.string().min(1).max(MAX_REFRESH_TOKEN_LENGTH),
    newPassword: zNewPassword,
  })
  .strict();

/** Validated `POST /auth/password/reset` body. */
export class ResetPasswordDto extends createZodDto(resetPasswordBodySchema) {}

/** `PATCH /auth/password` body. */
export const changePasswordBodySchema = z
  .object({
    // Only the upper bound: a short current password is simply wrong.
    currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
    newPassword: zNewPassword,
  })
  .strict();

/** Validated `PATCH /auth/password` body. */
export class ChangePasswordDto extends createZodDto(changePasswordBodySchema) {}
