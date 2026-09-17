import { z } from 'zod';
import { MAX_EMAIL_LENGTH } from './limits';

/**
 * The stored form of an email address: trimmed and lower-cased, nothing else (rdm-spec I-1's
 * `CHECK (email = lower(email))`). No dot or plus stripping — providers differ on what they mean.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** An email address from a client, normalized before it is validated. */
export const zEmail = z.string().transform(normalizeEmail).pipe(z.email().max(MAX_EMAIL_LENGTH));
