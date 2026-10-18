import { ApiError } from '@wayfare/api-client';
import { describe, expect, it } from 'vitest';
import type { TouristT } from '../i18n/tourist';
import {
  countdown,
  emailInvalid,
  formErrorOf,
  passwordTooShort,
  retryAfterSeconds,
} from './form-errors';
import { accountLinkOf, afterReset, linkResultOf } from './links';
import {
  deleteWordMatches,
  outdatedDocuments,
  phoneMoved,
  shouldOfferAccount,
  signedInCount,
} from './rules';

/** A `t` that shows the key and its arguments, so a test reads which message was chosen. */
const t = ((key: string, args?: object) =>
  args === undefined ? key : `${key} ${JSON.stringify(args)}`) as TouristT;
const failure = (code: string, details?: unknown) =>
  new ApiError(code === 'RATE_LIMITED' ? 429 : 400, code, code, details);

describe('the forms (K4, K7)', () => {
  it('say each code beside its field or in the banner', () => {
    expect(formErrorOf('create', failure('EMAIL_TAKEN'), t)).toEqual({
      place: 'email',
      title: 'account.error.emailTaken',
      action: 'sign-in-with-email',
    });
    expect(formErrorOf('signIn', failure('INVALID_CREDENTIALS'), t)).toMatchObject({
      place: 'banner',
      title: 'account.error.credentials.title',
    });
    expect(formErrorOf('signIn', failure('ACCOUNT_LOCKED'), t)).toMatchObject({
      body: 'account.error.locked.body',
    });
    expect(formErrorOf('password', failure('CURRENT_PASSWORD_INCORRECT'), t)?.place).toBe(
      'current',
    );
    // On the delete screen a wrong password is the current password's error.
    expect(formErrorOf('delete', failure('INVALID_CREDENTIALS'), t)?.place).toBe('current');
    expect(formErrorOf('email', failure('EMAIL_CHANGE_REVERT_PENDING'), t)?.title).toBe(
      'account.error.revertPending',
    );
    expect(formErrorOf('signIn', new ApiError(0, 'NETWORK_ERROR', 'x'), t)).toBeNull();
  });

  it('turn a rate limit into minutes, with Forgot password? offered', () => {
    const limited = failure('RATE_LIMITED', { retryAfterSeconds: 130 });
    expect(retryAfterSeconds(limited)).toBe(130);
    expect(formErrorOf('signIn', limited, t)).toMatchObject({
      body: 'account.error.tooMany.body {"minutes":3}',
      action: 'forgot',
    });
    expect(countdown(65)).toBe('1:05');
    expect(countdown(0)).toBe('0:00');
  });

  it('refuse a short password before the call', () => {
    expect(passwordTooShort('123456789', t)?.title).toBe('account.error.tooShort {"count":9}');
    expect(passwordTooShort('1234567890', t)).toBeNull();
  });

  it('refuse an address the API would refuse, beside its field, before the call', () => {
    expect(emailInvalid('mai@example', t)).toEqual({
      place: 'email',
      title: 'account.error.email',
    });
    expect(emailInvalid('not an email', t)?.place).toBe('email');
    expect(emailInvalid(' Mai@Example.com ', t)).toBeNull();
  });
});

describe('the links (K8–K10)', () => {
  it('read the page and the token from the fragment', () => {
    expect(accountLinkOf('https://wayfare.app/verify-email#token=abc')).toEqual({
      page: 'verify',
      token: 'abc',
    });
    expect(accountLinkOf('https://wayfare.app/reset-password#token=a%2Bb')).toEqual({
      page: 'reset',
      token: 'a+b',
    });
    expect(accountLinkOf('https://wayfare.app/p/AB12CD34')).toBeNull();
    expect(accountLinkOf('https://wayfare.app/verify-email')).toBeNull();
    expect(accountLinkOf('http://localhost:5174/verify-email#token=abc')).toBeNull();
  });

  it('show their result, or another account’s, or that the link no longer works', () => {
    expect(linkResultOf('verify', { sameAccount: true }, true)).toBe('verified');
    expect(linkResultOf('verify', { sameAccount: false }, false)).toBe('verified');
    expect(linkResultOf('confirm', { sameAccount: false }, true)).toBe('other-account');
    expect(linkResultOf('revert', { sameAccount: true }, true)).toBe('reverted');
    expect(linkResultOf('revert', 'expired', true)).toBe('expired');
  });

  it('sign in again after a reset only for this phone’s own account', () => {
    expect(afterReset(true, true)).toBe('sign-in-again');
    expect(afterReset(false, false)).toBe('sign-in-screen');
    // A reset for another account leaves this phone signed in as it was.
    expect(afterReset(false, true)).toBe('other-account');
  });
});

describe('the rules', () => {
  it('offer an account from two favourites, signed out, until dismissed (K19)', () => {
    expect(shouldOfferAccount({ signedIn: false, dismissed: false, favourites: 2 })).toBe(true);
    expect(shouldOfferAccount({ signedIn: false, dismissed: false, favourites: 1 })).toBe(false);
    expect(shouldOfferAccount({ signedIn: false, dismissed: false, favourites: 0 })).toBe(false);
    expect(shouldOfferAccount({ signedIn: false, dismissed: true, favourites: 5 })).toBe(false);
    expect(shouldOfferAccount({ signedIn: true, dismissed: false, favourites: 5 })).toBe(false);
  });

  it('check the typed word in the app’s language (K14)', () => {
    expect(deleteWordMatches(' DELETE ', 'DELETE')).toBe(true);
    expect(deleteWordMatches('delete', 'DELETE')).toBe(false);
    // "XÓA" typed with a combining accent is still the word.
    expect(deleteWordMatches('XÓA', 'XÓA')).toBe(true);
  });

  it('count the favourites that joined, or none (K6)', () => {
    expect(signedInCount(3)).toBe(3);
    expect(signedInCount(0)).toBeNull();
  });

  it('say once that a phone moved to another account (K3)', () => {
    expect(phoneMoved(null, 'a')).toBe(false);
    expect(phoneMoved('a', 'a')).toBe(false);
    expect(phoneMoved('b', 'a')).toBe(true);
  });

  it('ask again only for the outdated terms and privacy policy (K16)', () => {
    const rows = [
      { document: 'TERMS_OF_SERVICE', current: false },
      { document: 'PRIVACY_POLICY', current: true },
      { document: 'OWNER_AGREEMENT', current: false },
    ];
    expect(outdatedDocuments(rows, ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'])).toEqual([
      'TERMS_OF_SERVICE',
    ]);
  });
});
