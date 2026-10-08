import { describe, expect, it } from 'vitest';
import { restoreNullableTypes } from './swagger';

describe('restoreNullableTypes', () => {
  it('puts a flagged nullable string back, and leaves a genuine array alone', () => {
    const schemas = {
      Dto: {
        type: 'object',
        properties: {
          // `z.string().nullable()` after Nest read `type: ['string', 'null']` as "array of string"
          address: { 'x-nestjs_zod-empty-type': true, type: 'array', items: { type: 'string' } },
          // `z.array(z.string())`: a real array, never flagged
          roles: { type: 'array', items: { type: 'string' } },
          // already right
          priceBand: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        },
      },
    };
    restoreNullableTypes(schemas);
    expect(schemas.Dto.properties.address).toEqual({
      'x-nestjs_zod-empty-type': true,
      type: ['string', 'null'],
    });
    expect(schemas.Dto.properties.roles).toEqual({ type: 'array', items: { type: 'string' } });
    expect(schemas.Dto.properties.priceBand).toEqual({
      anyOf: [{ type: 'integer' }, { type: 'null' }],
    });
  });

  it('reaches properties nested in other schemas, and tolerates a missing document', () => {
    const nested = {
      Outer: {
        properties: {
          inner: {
            properties: {
              note: { 'x-nestjs_zod-empty-type': true, type: 'array', items: { type: 'integer' } },
            },
          },
        },
      },
    };
    restoreNullableTypes(nested);
    expect(nested.Outer.properties.inner.properties.note.type).toEqual(['integer', 'null']);
    expect(() => restoreNullableTypes(undefined)).not.toThrow();
  });
});
