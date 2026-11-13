// The check that keeps "You have  places" out of production (rdm-spec N-6).
import { describe, expect, it } from 'vitest';
import { icuArguments, sameIcuArguments } from './icu-arguments';
import { bundleSourceHash, readUiBundle, UI_NAMESPACES } from './locales';

describe('icuArguments', () => {
  it('reads plain, typed and nested arguments, and ignores quoted braces', () => {
    expect(icuArguments('Hello {name}')).toEqual(new Set(['name']));
    expect(icuArguments('{count, plural, one {# place} other {# places}}')).toEqual(
      new Set(['count']),
    );
    expect(icuArguments('{count, plural, other {# of {total}}}')).toEqual(
      new Set(['count', 'total']),
    );
    // ICU quoting runs to the closing apostrophe; an unclosed one quotes the rest of the message.
    expect(icuArguments("A literal '{brace}' and {name}")).toEqual(new Set(['name']));
    expect(icuArguments("Unclosed '{brace} and {name}")).toEqual(new Set());
    expect(icuArguments('no arguments at all')).toEqual(new Set());
  });
});

describe('sameIcuArguments', () => {
  it('passes a faithful translation and refuses a dropped or invented placeholder', () => {
    expect(sameIcuArguments('You have {count} places', 'Bạn có {count} địa điểm')).toBe(true);
    expect(sameIcuArguments('You have {count} places', 'Bạn có  địa điểm')).toBe(false);
    expect(sameIcuArguments('Hello {name}', 'Xin chào {name} {title}')).toBe(false);
    // The same arguments in another order are still the same arguments.
    expect(sameIcuArguments('{a} then {b}', '{b} sau {a}')).toBe(true);
  });
});

describe('the shipped UI bundles', () => {
  it.each(UI_NAMESPACES)('%s: vi carries every English key, with the same arguments', (ns) => {
    const source = readUiBundle('en', ns);
    const vi = readUiBundle('vi', ns);
    const byKey = (left: string, right: string) => left.localeCompare(right);
    expect(Object.keys(vi).sort(byKey)).toEqual(Object.keys(source).sort(byKey));
    for (const [key, message] of Object.entries(source)) {
      expect(sameIcuArguments(message, vi[key]!), key).toBe(true);
    }
  });

  it('hashes the English source, and only the English source', () => {
    const hash = bundleSourceHash('tourist');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundleSourceHash('tourist')).toBe(hash);
    expect(bundleSourceHash('console')).not.toBe(hash);
  });
});
