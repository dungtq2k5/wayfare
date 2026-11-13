import type { Language } from '@wayfare/contracts';
import { describe, expectTypeOf, it } from 'vitest';
import type { PlaceSummaryResponseDto } from './generated/model';

describe('the generated client', () => {
  it('types a served language as the union of served languages, not as a string', () => {
    expectTypeOf<PlaceSummaryResponseDto['lang']>().toEqualTypeOf<Language>();
  });
});
