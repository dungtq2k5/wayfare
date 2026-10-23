import { z } from 'zod';
import { zLanguage } from '../common/languages';
import { zEmail } from './email';
import {
  MAX_FULL_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_REFRESH_TOKEN_LENGTH,
  MIN_PASSWORD_LENGTH,
} from './limits';

/*
 * The bodies a form sends, shared by the gateway, which validates them, and the console, which
 * checks a form against the same limits before sending (api-endpoints-plan §1.2, §1.3).
 */

/** A password being chosen. */
export const zNewPassword = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

/** A name the person types; blank is not a name. */
export const zFullName = z.string().trim().min(1).max(MAX_FULL_NAME_LENGTH);

/** `POST /auth/login`. A short password is simply wrong — only the upper bound is checked. */
export const loginBodySchema = z
  .object({
    email: zEmail,
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  })
  .strict();

/**
 * `POST /auth/password/reset`: a reset or setup link, and the new password. `preferredLocale` is
 * the language the page was read in, saved only by an `ACCOUNT_SETUP` link — the account's first
 * step.
 */
export const resetPasswordBodySchema = z
  .object({
    token: z.string().min(1).max(MAX_REFRESH_TOKEN_LENGTH),
    newPassword: zNewPassword,
    preferredLocale: zLanguage.optional(),
  })
  .strict();

/** `PATCH /auth/password`. Only the current password's upper bound: a short one is simply wrong. */
export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
    newPassword: zNewPassword,
  })
  .strict();

/** `PATCH /users/me` — the name and the UI language only; nothing is defaulted. */
export const updateMeBodySchema = z
  .object({
    fullName: zFullName.optional(),
    preferredLocale: zLanguage.optional(),
  })
  .strict();
