import { z } from 'zod';
import { MAX_GOOGLE_TOKEN_LENGTH, MAX_PASSWORD_LENGTH } from './limits';

/**
 * A protected route's proof that the caller is the account's person (api-endpoints-plan §1.3):
 * the current password, or for an account that signs in with Google only, a Google confirmation —
 * exactly one of them.
 */
export const itsYouFields = {
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH).optional(),
  confirmation: z.string().min(1).max(MAX_GOOGLE_TOKEN_LENGTH).optional(),
};

/** Refines an object holding `itsYouFields`: exactly one of the two. */
export const exactlyOneProof = <T extends { currentPassword?: string; confirmation?: string }>(
  body: T,
): boolean => (body.currentPassword === undefined) !== (body.confirmation === undefined);
