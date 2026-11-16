import type { i18n as I18n } from 'i18next';
import { describe, expect, it } from 'vitest';
import { touristFrom } from './tourist';

/** Just enough of i18next: a flat message map with `exists` and `t`. */
function fakeI18n(messages: Record<string, string>): I18n {
  return {
    t: (key: string) => messages[key] ?? key,
    exists: (key: string) => key in messages,
  } as unknown as I18n;
}

const { t, tFamily } = touristFrom(
  fakeI18n({
    'nav.map': 'Map',
    'error.generic': 'Something went wrong.',
    'error.DEVICE_REVOKED': 'This phone was removed.',
    'area.hcmc-d1-core': 'District 1 centre',
  }),
);

describe('touristFrom', () => {
  it('translates a key', () => {
    expect(t('nav.map')).toBe('Map');
  });

  it('looks a family key up by its suffix', () => {
    expect(tFamily('area', 'hcmc-d1-core')).toBe('District 1 centre');
    expect(tFamily('error', 'DEVICE_REVOKED')).toBe('This phone was removed.');
  });

  it('renders the fallback for a suffix the English file lacks', () => {
    expect(tFamily('area', 'hcmc-d9', 'hcmc-d9')).toBe('hcmc-d9');
    expect(tFamily('area', 'hcmc-d9')).toBe('hcmc-d9');
  });

  it('renders error.generic for an unknown error code', () => {
    expect(tFamily('error', 'BRAND_NEW_CODE')).toBe('Something went wrong.');
  });
});
