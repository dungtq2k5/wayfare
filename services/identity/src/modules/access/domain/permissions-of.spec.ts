import { describe, expect, it } from 'vitest';
import { permissionsOf, roleCodesOf } from './permissions-of';

describe('permissionsOf', () => {
  it('unions, de-duplicates and sorts the grants of every role', () => {
    expect(
      permissionsOf([
        {
          code: 'ADMIN',
          permissions: [
            { code: 'user.read', isRetired: false },
            { code: 'audit.read', isRetired: false },
          ],
        },
        { code: 'CONTENT_MODERATOR', permissions: [{ code: 'user.read', isRetired: false }] },
      ]),
    ).toEqual(['audit.read', 'user.read']);
  });

  it('drops a retired code a custom role still holds', () => {
    expect(
      permissionsOf([{ code: 'CUSTOM', permissions: [{ code: 'old.thing', isRetired: true }] }]),
    ).toEqual([]);
  });

  it('is empty without roles, and sorts role codes', () => {
    expect(permissionsOf([])).toEqual([]);
    expect(
      roleCodesOf([
        { code: 'USER', permissions: [] },
        { code: 'ADMIN', permissions: [] },
      ]),
    ).toEqual(['ADMIN', 'USER']);
  });
});
