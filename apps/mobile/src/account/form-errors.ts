import { ApiError } from '@wayfare/api-client';
import { MIN_PASSWORD_LENGTH, zEmail } from '@wayfare/contracts';
import type { TouristT } from '../i18n/tourist';

/** The account's forms (frames G1, G4, G8, A3, A4, A7, L2). */
export type AccountForm =
  'create' | 'signIn' | 'forgot' | 'email' | 'password' | 'delete' | 'reset';

/** Where a form shows an error: beside a field (G2, A4), or in the banner (G5). */
export type ErrorPlace = 'email' | 'password' | 'current' | 'terms' | 'word' | 'banner';

export interface FormError {
  readonly place: ErrorPlace;
  /** The banner's title, or the field's line. */
  readonly title: string;
  readonly body?: string;
  /** A next step the error offers: *Sign in with this email* (G2), *Forgot password?* (G5). */
  readonly action?: 'sign-in-with-email' | 'forgot';
}

/** Seconds until the window reopens: `details.retryAfterSeconds` of a `RATE_LIMITED` (K4). */
export function retryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== 'RATE_LIMITED') return null;
  const seconds = (error.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
  return typeof seconds === 'number' ? seconds : null;
}

/** A password the API would refuse for its length, said before the call (G2). */
export function passwordTooShort(password: string, t: TouristT): FormError | null {
  return password.length < MIN_PASSWORD_LENGTH
    ? { place: 'password', title: t('account.error.tooShort', { count: password.length }) }
    : null;
}

/** An address the API would refuse, by the API's own rule, said beside its field before the call. */
export function emailInvalid(email: string, t: TouristT): FormError | null {
  return zEmail.safeParse(email).success
    ? null
    : { place: 'email', title: t('account.error.email') };
}

/**
 * An answer's code as the form says it (handoff §5), beside its field or in the banner, keeping
 * what was typed. Null for a failure the form does not own (offline, or a server fault, which the
 * caller says with `errorMessage`).
 */
export function formErrorOf(form: AccountForm, error: unknown, t: TouristT): FormError | null {
  if (!(error instanceof ApiError)) return null;
  switch (error.code) {
    case 'EMAIL_TAKEN':
      return {
        place: 'email',
        title: t('account.error.emailTaken'),
        ...(form === 'create' ? { action: 'sign-in-with-email' as const } : {}),
      };
    case 'INVALID_CREDENTIALS':
      // On the delete screen, the only credential typed is the current password.
      return form === 'delete'
        ? { place: 'current', title: t('account.error.currentPassword') }
        : {
            place: 'banner',
            title: t('account.error.credentials.title'),
            body: t('account.error.credentials.body'),
          };
    case 'CURRENT_PASSWORD_INCORRECT':
      return { place: 'current', title: t('account.error.currentPassword') };
    case 'ACCOUNT_LOCKED':
      return {
        place: 'banner',
        title: t('account.error.locked.title'),
        body: t('account.error.locked.body'),
      };
    case 'RATE_LIMITED': {
      const minutes = Math.max(1, Math.ceil((retryAfterSeconds(error) ?? 60) / 60));
      return {
        place: 'banner',
        title: t('account.error.tooMany.title'),
        body: t('account.error.tooMany.body', { minutes }),
        action: 'forgot',
      };
    }
    case 'EMAIL_CHANGE_REVERT_PENDING':
      return { place: 'banner', title: t('account.error.revertPending') };
    default:
      return null;
  }
}

/** `m:ss` for G3b's count. */
export function countdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
