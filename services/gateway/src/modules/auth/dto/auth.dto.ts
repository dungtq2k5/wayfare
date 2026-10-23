import {
  MAX_FULL_NAME_LENGTH,
  MAX_GOOGLE_TOKEN_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_POLICY_VERSION_LENGTH,
  MAX_REFRESH_TOKEN_LENGTH,
  MIN_PASSWORD_LENGTH,
  zEmail,
  zLanguage,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /auth/register` body (api-endpoints-plan §1.2). */
export const registerBodySchema = z
  .object({
    email: zEmail,
    password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
    fullName: z.string().trim().min(1).max(MAX_FULL_NAME_LENGTH).optional(),
    preferredLocale: zLanguage,
    termsVersion: z.string().trim().min(1).max(MAX_POLICY_VERSION_LENGTH),
  })
  .strict();

/** Validated `POST /auth/register` body. */
export class RegisterDto extends createZodDto(registerBodySchema) {}

/** `POST /auth/login` body. A short password is simply wrong — only the upper bound is checked. */
export const loginBodySchema = z
  .object({
    email: zEmail,
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  })
  .strict();

/** Validated `POST /auth/login` body. */
export class LoginDto extends createZodDto(loginBodySchema) {}

/**
 * `POST /auth/refresh` and `POST /auth/logout` body. `mobile` sends its refresh token here;
 * `console` and `web` use the cookie, and a token in their body is ignored.
 */
export const refreshBodySchema = z.preprocess(
  // A cookie client may send no body at all, which Express leaves undefined.
  (value) => value ?? {},
  z.object({ refreshToken: z.string().min(1).max(MAX_REFRESH_TOKEN_LENGTH).optional() }).strict(),
);

/** Validated refresh or logout body. */
export class RefreshDto extends createZodDto(refreshBodySchema) {}

/** A Google ID token in a body (ADR 0062). Secret: never logged. */
const zGoogleIdToken = z.string().min(1).max(MAX_GOOGLE_TOKEN_LENGTH);

/** `POST /auth/google` body: the ID token carrying this device's nonce, and the account's language. */
export const googleSignInBodySchema = z
  .object({ idToken: zGoogleIdToken, preferredLocale: zLanguage })
  .strict();

/** Validated `POST /auth/google` body. */
export class GoogleSignInDto extends createZodDto(googleSignInBodySchema) {}

/** `POST /auth/google/confirm` body: a fresh ID token for the caller's own Google account. */
export const googleConfirmBodySchema = z.object({ idToken: zGoogleIdToken }).strict();

/** Validated `POST /auth/google/confirm` body. */
export class GoogleConfirmDto extends createZodDto(googleConfirmBodySchema) {}

/** `POST /auth/google/link` body: the ticket a `GOOGLE_LINK_NEEDS_PASSWORD` answer carried. */
export const googleLinkBodySchema = z
  .object({ linkTicket: z.string().min(1).max(MAX_GOOGLE_TOKEN_LENGTH) })
  .strict();

/** Validated `POST /auth/google/link` body. */
export class GoogleLinkDto extends createZodDto(googleLinkBodySchema) {}
