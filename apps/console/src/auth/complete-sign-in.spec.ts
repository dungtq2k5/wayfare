// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPageCookie } from '@wayfare/ui/cookies';
import { forgetCookie } from '@wayfare/ui/testing';
import { completeSignIn } from './complete-sign-in';

describe('a session just opened (C5, K12)', () => {
  const assign = vi.fn();

  beforeEach(() => {
    assign.mockClear();
    forgetCookie('wf_signed_in');
    forgetCookie('wf_lang');
    vi.stubGlobal('location', { assign });
  });

  it('remembers it, takes the account’s language, and returns to the page asked for', () => {
    completeSignIn({ preferredLocale: 'vi' }, '/places?q=pho');
    expect(readPageCookie('wf_signed_in')).toBe('1');
    expect(readPageCookie('wf_lang')).toBe('vi');
    expect(assign).toHaveBeenCalledWith('/places?q=pho');
  });

  it('goes Home for no page, or one on another site', () => {
    completeSignIn({ preferredLocale: 'en' }, null);
    completeSignIn({ preferredLocale: 'en' }, '//evil.test/x');
    expect(assign.mock.calls).toEqual([['/'], ['/']]);
  });
});
