import { ApiError } from '@wayfare/api-client';

/** Why Continue with Google ended without a session; each has its screen (frames K7, K8). */
export type GoogleFailure =
  | 'no-account'
  | 'unreachable'
  | 'not-verified'
  | 'not-allowed'
  | 'already-linked'
  | 'deactivated'
  | 'unavailable';

/** A server refusal as the screens say it; null for one the form shows itself (offline, 429). */
export function failureOf(error: unknown): GoogleFailure | null {
  if (!(error instanceof ApiError)) return null;
  switch (error.code) {
    case 'GOOGLE_UNAVAILABLE':
      return 'unreachable';
    case 'INVALID_GOOGLE_TOKEN':
      return (error.details as { reason?: string } | undefined)?.reason === 'EMAIL_NOT_VERIFIED'
        ? 'not-verified'
        : 'unreachable';
    case 'GOOGLE_SIGN_IN_NOT_ALLOWED':
      return 'not-allowed';
    case 'GOOGLE_ACCOUNT_ALREADY_LINKED':
      return 'already-linked';
    case 'ACCOUNT_DEACTIVATED':
      return 'deactivated';
    default:
      return null;
  }
}
