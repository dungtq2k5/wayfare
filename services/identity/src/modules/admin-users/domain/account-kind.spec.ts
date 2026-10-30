import { AccountKind } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { kindOf } from './account-kind';

describe('kindOf', () => {
  it('a tourist holds nothing, or USER only', () => {
    expect(kindOf([])).toBe(AccountKind.TOURIST);
    expect(kindOf(['USER'])).toBe(AccountKind.TOURIST);
  });

  it('an owner holds VENUE_OWNER', () => {
    expect(kindOf(['USER', 'VENUE_OWNER'])).toBe(AccountKind.OWNER);
  });

  it('any other role is staff, a custom one included, and wins over owner', () => {
    expect(kindOf(['ADMIN'])).toBe(AccountKind.STAFF);
    expect(kindOf(['CUSTOM_SUPPORT'])).toBe(AccountKind.STAFF);
    expect(kindOf(['VENUE_OWNER', 'CONTENT_MODERATOR'])).toBe(AccountKind.STAFF);
  });
});
