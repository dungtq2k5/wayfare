import { describe, expect, it } from 'vitest';
import { zCursorQuery, zPageQuery } from './pagination';
import { zBooleanParam } from './params';

describe('zCursorQuery', () => {
  it('defaults the limit and bounds it', () => {
    expect(zCursorQuery.parse({})).toEqual({ limit: 20 });
    expect(zCursorQuery.parse({ limit: '100', cursor: 'abc' })).toEqual({
      limit: 100,
      cursor: 'abc',
    });
    expect(zCursorQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(zCursorQuery.safeParse({ limit: '0' }).success).toBe(false);
  });
});

describe('zPageQuery', () => {
  const schema = zPageQuery({ sort: ['createdAt', 'name'], defaultSort: '-createdAt' });
  const searchable = zPageQuery({ sort: ['name'], defaultSort: 'name', search: true });

  it('defaults page, size and sort', () => {
    expect(schema.parse({})).toEqual({ page: 1, pageSize: 20, sort: '-createdAt' });
  });

  it('accepts only allowlisted sort fields, either direction', () => {
    expect(schema.parse({ sort: '-name' }).sort).toBe('-name');
    expect(schema.safeParse({ sort: 'passwordHash' }).success).toBe(false);
  });

  it('has q only when the route searches', () => {
    expect(schema.safeParse({ q: 'x' }).success).toBe(false);
    expect(searchable.parse({ q: ' market ' })).toMatchObject({ q: 'market' });
  });

  it('refuses a default outside the allowlist when the schema is built', () => {
    expect(() => zPageQuery({ sort: ['name'], defaultSort: 'id' as 'name' })).toThrow(/allowlist/);
  });
});

describe('zBooleanParam', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['false', false],
    ['False', false],
    ['0', false],
  ])('%s → %s', (value, expected) => {
    expect(zBooleanParam.parse(value)).toBe(expected);
  });

  it('refuses anything else and keeps an absent key absent', () => {
    expect(zBooleanParam.safeParse('yes').success).toBe(false);
    expect(zBooleanParam.parse(undefined)).toBeUndefined();
  });
});
