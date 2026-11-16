import { describe, expect, it } from 'vitest';
import { argumentType, renderArgumentTypes } from './arguments-types';
import { icuArgumentTypes } from './icu-arguments';

const kinds = (message: string) =>
  Object.fromEntries([...icuArgumentTypes(message)].map(([name, arg]) => [name, arg.kind]));

describe('icuArgumentTypes', () => {
  it('reads the kind of each argument', () => {
    expect(kinds('{minutes} min')).toEqual({ minutes: 'plain' });
    expect(kinds('{n, number} {d, date, short} {t, time}')).toEqual({
      n: 'number',
      d: 'date',
      t: 'time',
    });
    expect(kinds('{c, plural, one {# a} other {# b}} {o, selectordinal, other {#th}}')).toEqual({
      c: 'plural',
      o: 'selectordinal',
    });
  });

  it('does not take # for an argument: the count is the plural’s own', () => {
    expect(kinds('{count, plural, other {# of {total}}}')).toEqual({
      count: 'plural',
      total: 'plain',
    });
  });

  it('keeps the more specific kind when a name is used twice', () => {
    expect(kinds('{n} then {n, plural, other {#}}')).toEqual({ n: 'plural' });
  });

  it('lists a select’s options, and the options of every use', () => {
    const select = icuArgumentTypes('{g, select, male {He} female {She} other {They}}').get('g');
    expect(select).toEqual({ kind: 'select', options: ['male', 'female', 'other'] });
    const merged = icuArgumentTypes('{g, select, a {x} other {y}} {g, select, b {x} other {y}}');
    expect(merged.get('g')?.options).toEqual(['a', 'other', 'b']);
  });

  it('ignores quoted braces', () => {
    expect(kinds("A '{literal}' and {name}")).toEqual({ name: 'plain' });
  });
});

describe('argumentType', () => {
  it('maps each kind to the value a caller passes', () => {
    expect(argumentType({ kind: 'plural', options: [] })).toBe('number');
    expect(argumentType({ kind: 'date', options: [] })).toBe('Date | number');
    expect(argumentType({ kind: 'plain', options: [] })).toBe('string | number');
    expect(argumentType({ kind: 'select', options: ['male', 'female'] })).toBe('"male" | "female"');
    expect(argumentType({ kind: 'select', options: ['male', 'other'] })).toBe('"male" | string');
  });
});

describe('renderArgumentTypes', () => {
  it('lists only the messages that have arguments', () => {
    const source = renderArgumentTypes(
      'X',
      { a: 'plain', b: '{m} min', c: '{count, plural, other {# of {total}}}' },
      'pnpm x',
    );
    expect(source).toContain('export interface X {');
    expect(source).not.toContain('"a"');
    expect(source).toContain('readonly "b": { "m": string | number };');
    expect(source).toContain('readonly "c": { "count": number; "total": string | number };');
  });
});
