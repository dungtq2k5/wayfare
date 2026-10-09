import { describe, expect, it } from 'vitest';
import { engineLocale, hasVoiceFor, splitSentences } from './speech-text';

describe('splitSentences', () => {
  it('splits Vietnamese and English text at sentence ends', () => {
    expect(splitSentences('Chợ Bến Thành nằm ở Quận 1. Chợ mở từ sáng! Bạn đã đến chưa?')).toEqual([
      'Chợ Bến Thành nằm ở Quận 1.',
      'Chợ mở từ sáng!',
      'Bạn đã đến chưa?',
    ]);
  });

  it('splits CJK text, which has no spaces between sentences', () => {
    expect(splitSentences('これは市場です。とても古い！ご覧ください？')).toEqual([
      'これは市場です。',
      'とても古い！',
      'ご覧ください？',
    ]);
  });

  it('keeps a closing quote with its sentence, and a last sentence with no full stop', () => {
    expect(splitSentences('He said “go.” Then he left')).toEqual(['He said “go.”', 'Then he left']);
  });

  it('gives nothing for blank text', () => {
    expect(splitSentences('  \n ')).toEqual([]);
  });
});

describe('the engine locale', () => {
  it('maps the Chinese scripts to the tags Android knows', () => {
    expect(engineLocale('zh-Hans')).toBe('zh-CN');
    expect(engineLocale('zh-Hant')).toBe('zh-TW');
    expect(engineLocale('vi')).toBe('vi');
  });

  it('finds a voice by language, whatever its separator or region', () => {
    expect(hasVoiceFor(['en_US', 'vi-VN'], 'vi')).toBe(true);
    expect(hasVoiceFor(['zh-CN'], 'zh-Hans')).toBe(true);
    expect(hasVoiceFor(['zh-CN'], 'zh-Hant')).toBe(false);
    expect(hasVoiceFor(['en-US'], 'ja')).toBe(false);
  });
});
