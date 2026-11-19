// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { clearPageCookie, readPageCookie, setPageCookie } from './cookies';

describe('the web app’s own cookies', () => {
  it('keeps a value as it was written, even one with = and spaces, and reads it back', () => {
    setPageCookie('wf_web_test', 'a=b c');
    expect(readPageCookie('wf_web_test')).toBe('a=b c');
  });

  it('reads none for a cookie never set', () => {
    expect(readPageCookie('wf_web_never')).toBeNull();
  });

  it('writes a year-long, site-wide, lax cookie, and clears one by expiring it now', () => {
    const written = vi.spyOn(document, 'cookie', 'set');
    setPageCookie('wf_web_lang', 'vi');
    clearPageCookie('wf_web_account');
    expect(written.mock.calls.map(([value]) => value)).toEqual([
      'wf_web_lang=vi; Path=/; Max-Age=31536000; SameSite=Lax',
      'wf_web_account=; Path=/; Max-Age=0; SameSite=Lax',
    ]);
  });
});
