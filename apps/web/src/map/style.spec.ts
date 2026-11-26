// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { areaStyle } from './style';

const pack = (styleDark: string | null) =>
  ({ mapPack: { style: 'light.json', styleDark } }) as never;

describe('the area pack’s map style', () => {
  afterEach(() => document.documentElement.classList.remove('dark'));

  it('is none for no area, or an area with no pack', () => {
    expect(areaStyle(null)).toBeNull();
    expect(areaStyle({ mapPack: null })).toBeNull();
  });

  it('is the light style on a light page', () => {
    expect(areaStyle(pack('dark.json'))).toBe('light.json');
  });

  it('is the dark flavour on a dark page, or the light one when the pack has no dark', () => {
    document.documentElement.classList.add('dark');
    expect(areaStyle(pack('dark.json'))).toBe('dark.json');
    expect(areaStyle(pack(null))).toBe('light.json');
  });
});
