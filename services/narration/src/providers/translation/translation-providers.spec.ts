import { describe, expect, it, vi } from 'vitest';
import { FakeTranslationProvider } from './fake.translation-provider';
import { FreeTranslationProvider } from './free.translation-provider';
import { GoogleTranslationProvider } from './google.translation-provider';
import type { GoogleTranslateClient } from './google.translation-provider';
import { googleTranslateCode } from './language-codes';

describe('translation language codes', () => {
  it('maps Chinese by script to Google’s regions, and knows nothing it was not told', () => {
    expect(googleTranslateCode('zh-Hans')).toBe('zh-CN');
    expect(googleTranslateCode('zh-Hant')).toBe('zh-TW');
    expect(googleTranslateCode('ja')).toBe('ja');
    expect(googleTranslateCode('xx')).toBeNull();
    expect(googleTranslateCode('constructor')).toBeNull();
  });
});

describe('FakeTranslationProvider', () => {
  it('prefixes the language, keeps vi, and fails when told to', async () => {
    const fake = new FakeTranslationProvider();
    await expect(fake.translate({ text: 'Chợ', from: 'vi', to: 'en' })).resolves.toBe('[en] Chợ');
    await expect(fake.translate({ text: 'Chợ', from: 'vi', to: 'vi' })).resolves.toBe('Chợ');
    await expect(
      new FakeTranslationProvider(true).translate({ text: 'x', from: 'vi', to: 'en' }),
    ).rejects.toThrow();
  });
});

describe('GoogleTranslationProvider', () => {
  it('asks v3 for plain text in the mapped codes', async () => {
    const translateText = vi.fn<GoogleTranslateClient['translateText']>(() =>
      Promise.resolve([{ translations: [{ translatedText: '市场' }] }] as const),
    );
    const google = new GoogleTranslationProvider('wayfare-test', { translateText });
    await expect(google.translate({ text: 'Chợ', from: 'vi', to: 'zh-Hans' })).resolves.toBe(
      '市场',
    );
    expect(translateText).toHaveBeenCalledWith({
      parent: 'projects/wayfare-test/locations/global',
      contents: ['Chợ'],
      mimeType: 'text/plain',
      sourceLanguageCode: 'vi',
      targetLanguageCode: 'zh-CN',
    });
    expect(google.supports('fr')).toBe(true);
  });

  it('answers an empty string when Google returns nothing, which the chain treats as a failure', async () => {
    const google = new GoogleTranslationProvider('p', {
      translateText: () => Promise.resolve([{ translations: [] }] as const),
    });
    await expect(google.translate({ text: 'x', from: 'vi', to: 'en' })).resolves.toBe('');
  });
});

describe('FreeTranslationProvider', () => {
  it('calls the free route with the mapped codes, in batch mode', async () => {
    const call = vi.fn(() => Promise.resolve({ text: 'Market' }));
    const free = new FreeTranslationProvider(call);
    await expect(free.translate({ text: 'Chợ', from: 'vi', to: 'en' })).resolves.toBe('Market');
    expect(call).toHaveBeenCalledWith('Chợ', { from: 'vi', to: 'en', forceBatch: true });
  });
});
