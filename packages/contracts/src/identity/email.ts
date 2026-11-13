import { z } from 'zod';
import { MAX_EMAIL_LENGTH } from './limits';

/**
 * The stored form of an email address: trimmed and lower-cased, nothing else (rdm-spec I-1's
 * `CHECK (email = lower(email))`). No dot or plus stripping — providers differ on what they mean.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * An address as support may see it (conventions §9.4): the local part's first and last characters
 * around `***`, the domain kept — `a***e@example.com`. A one-character local part becomes `*`.
 */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf('@');
  const local = at < 0 ? value : value.slice(0, at);
  const domain = at < 0 ? '' : value.slice(at);
  const masked =
    local.length <= 1
      ? '*'
      : local.length === 2
        ? `${local.charAt(0)}*`
        : `${local.charAt(0)}***${local.charAt(local.length - 1)}`;
  return `${masked}${domain}`;
}

/** An email address from a client, normalized before it is validated. */
export const zEmail = z.string().transform(normalizeEmail).pipe(z.email().max(MAX_EMAIL_LENGTH));
