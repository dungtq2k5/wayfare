import { describe, expect, it } from 'vitest';
import { filtersFrom, queryOf } from './places-url';

describe("the Places list's URL", () => {
  it('reads each filter from the URL', () => {
    expect(
      filtersFrom(
        new URLSearchParams('status=STUCK&areaId=a1&ownerUserId=u1&includeDeleted=true&q=Oc'),
      ),
    ).toEqual({
      q: 'Oc',
      status: 'STUCK',
      kind: null,
      areaId: 'a1',
      categoryCode: null,
      ownerUserId: 'u1',
      includeDeleted: true,
    });
  });

  it('writes back only the set filters, so the list is a link', () => {
    const filters = filtersFrom(new URLSearchParams('kind=VENUE&ownerUserId=u1'));
    expect(queryOf(filters)).toBe('kind=VENUE&ownerUserId=u1');
    expect(queryOf(filtersFrom(new URLSearchParams()))).toBe('');
    expect(filtersFrom(new URLSearchParams(queryOf({ ...filters, status: 'STUCK' })))).toEqual({
      ...filters,
      status: 'STUCK',
    });
  });
});
