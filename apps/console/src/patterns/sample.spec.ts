import { describe, expect, it } from 'vitest';
import { SAMPLE_AREAS, SAMPLE_CATEGORIES, SAMPLE_PLACES } from './sample';

describe('the patterns page’s sample Places (K16)', () => {
  it('has 248, the first twenty by their own names, later rounds numbered', () => {
    expect(SAMPLE_PLACES).toHaveLength(248);
    expect(SAMPLE_PLACES[0]).toMatchObject({ name: 'Phở Hòa Pasteur', status: 'active' });
    expect(SAMPLE_PLACES[20]!.name).toBe('Phở Hòa Pasteur 2');
  });

  it('gives each a distinct code printed 4 + 4, the same every run', () => {
    const codes = SAMPLE_PLACES.map((place) => place.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{4} [A-Z2-9]{4}$/);
  });

  it('lists each area and category once', () => {
    expect(SAMPLE_AREAS).toContain('District 1');
    expect(new Set(SAMPLE_AREAS).size).toBe(SAMPLE_AREAS.length);
    expect(new Set(SAMPLE_CATEGORIES).size).toBe(SAMPLE_CATEGORIES.length);
  });
});
