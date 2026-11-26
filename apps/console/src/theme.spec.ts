import { describe, expect, it } from 'vitest';
import { themeOf } from './theme';

describe('the browser’s appearance (K11)', () => {
  it('keeps a known theme and reads anything else as the system’s', () => {
    expect(themeOf('dark')).toBe('dark');
    expect(themeOf('light')).toBe('light');
    expect(themeOf('sepia')).toBe('system');
    expect(themeOf(undefined)).toBe('system');
    expect(themeOf(null)).toBe('system');
  });
});
