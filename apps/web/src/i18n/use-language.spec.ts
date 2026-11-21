// @vitest-environment happy-dom
import { AnalyticsEventType } from '@wayfare/contracts';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPageCookie, setPageCookie } from '@wayfare/ui/cookies';
import { forgetCookie } from '@wayfare/ui/testing';
import { renderHook, settle } from '@wayfare/ui/testing';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({
  devicesUpdate: vi.fn(() => Promise.resolve({})),
  usersUpdate: vi.fn(() => Promise.resolve({})),
}));
vi.mock('@wayfare/api-client', () => api);
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../analytics/analytics', () => analytics);

const { useChooseLanguage } = await import('./use-language');

describe('choosing a language (K7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetCookie('wf_web_account');
  });

  it('keeps it on this browser, re-renders the page, counts it, and tells the device', async () => {
    const rendered = await renderHook(() => useChooseLanguage());
    act(() => rendered.current().choose('ja'));
    await settle();
    expect(readPageCookie('wf_web_lang')).toBe('ja');
    expect(router.refresh).toHaveBeenCalled();
    expect(analytics.track).toHaveBeenCalledWith({
      type: AnalyticsEventType.LANGUAGE_SELECTED,
      lang: 'ja',
    });
    expect(api.devicesUpdate).toHaveBeenCalledWith({ contentLocale: 'ja' });
    expect(api.usersUpdate).not.toHaveBeenCalled();
  });

  it('tells the account too when signed in, and reads it again', async () => {
    setPageCookie('wf_web_account', '1');
    const rendered = await renderHook(() => useChooseLanguage());
    const invalidate = vi.spyOn(rendered.queries, 'invalidateQueries');
    act(() => rendered.current().choose('vi'));
    await settle();
    expect(api.usersUpdate).toHaveBeenCalledWith({ preferredLocale: 'vi' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] });
  });

  it('keeps the page in the new language when the device or account can’t be told', async () => {
    setPageCookie('wf_web_account', '1');
    api.devicesUpdate.mockRejectedValueOnce(new Error('offline'));
    api.usersUpdate.mockRejectedValueOnce(new Error('offline'));
    const rendered = await renderHook(() => useChooseLanguage());
    act(() => rendered.current().choose('ko'));
    await settle();
    expect(readPageCookie('wf_web_lang')).toBe('ko');
  });
});
