// The check that keeps "You have  places" out of production (rdm-spec N-6).
import { describe, expect, it } from 'vitest';
import { icuArguments, icuArgumentTypes, sameIcuArguments } from './icu-arguments';
import { bundleSourceHash, readUiBundle, UI_NAMESPACES } from './locales';

describe('icuArgumentTypes', () => {
  it('reads a doubled apostrophe as a literal one, and an unclosed brace to the message’s end', () => {
    expect([...icuArgumentTypes("It''s {name}")]).toEqual([
      ['name', { kind: 'plain', options: [] }],
    ]);
    expect([...icuArgumentTypes('Hello {name')]).toEqual([
      ['name', { kind: 'plain', options: [] }],
    ]);
  });

  it('reads a select’s options, a quoted brace in one as text and an argument in one as an argument', () => {
    expect([...icuArgumentTypes("{g, select, a {It'{'s {x}} other {y}}")]).toEqual([
      ['g', { kind: 'select', options: ['a', 'other'] }],
      ['x', { kind: 'plain', options: [] }],
    ]);
  });

  it('keeps the more specific kind of an argument seen twice, and joins two selects’ options', () => {
    expect(icuArgumentTypes('{g} then {g, select, a {A} other {B}}').get('g')).toEqual({
      kind: 'select',
      options: ['a', 'other'],
    });
    expect(
      icuArgumentTypes('{g, select, a {A} other {B}} and {g, select, b {C} other {D}}').get('g'),
    ).toEqual({ kind: 'select', options: ['a', 'other', 'b'] });
  });

  it('reads a quoted option name as its text, in a select and a plural alike', () => {
    expect(icuArgumentTypes("{g, select, 'a' {one} b {two}}").get('g')).toEqual({
      kind: 'select',
      options: ['a', 'b'],
    });
    expect(
      [...icuArgumentTypes("{n, plural, 'x' one {# of {total}} other {#}}")].map(([name]) => name),
    ).toEqual(['n', 'total']);
  });

  it('keeps a select when the same argument is later seen plain, and reads a quoted type as no type', () => {
    expect(icuArgumentTypes('{g, select, a {A} other {B}} then {g}').get('g')?.kind).toBe('select');
    expect(icuArgumentTypes("{n, 'number', x}").get('n')?.kind).toBe('plain');
  });

  it('reads no argument in a number’s skeleton or a quoted date style', () => {
    expect([...icuArgumentTypes('{n, number, ::currency/{x}}')]).toEqual([
      ['n', { kind: 'number', options: [] }],
    ]);
    expect([...icuArgumentTypes("{n, date, 'short' }")]).toEqual([
      ['n', { kind: 'date', options: [] }],
    ]);
  });
});

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
    // As many arguments, one renamed: not the same.
    expect(sameIcuArguments('{a} {b}', '{a} {c}')).toBe(false);
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
