import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// The component's i18n instance, as react-i18next hands it over.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: i18next }) }));

const { useTourist } = await import('./use-tourist');

describe('translating in a component', () => {
  beforeAll(async () => {
    await i18next.init({
      lng: 'en',
      resources: { en: { translation: { 'error.generic': 'Something went wrong' } } },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  it('reads the running i18n’s words, and a family’s fallback when a key is missing', () => {
    const { t, tFamily } = useTourist();
    expect(t('error.generic' as never)).toBe('Something went wrong');
    expect(tFamily('error', 'NEVER_SEEN')).toBe('Something went wrong');
    expect(tFamily('category', 'NEW', 'New')).toBe('New');
  });
});
