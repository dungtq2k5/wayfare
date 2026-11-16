import { describe, expect, it } from 'vitest';
import { lackedCodes, mayGive } from './level';

describe('the level rule', () => {
  const admin = ['user.read', 'user.lock', 'audit.read'];

  it('names the codes the account holds and the viewer lacks', () => {
    expect(lackedCodes(admin, ['user.read', 'role.create', 'user.role.assign'])).toEqual([
      'role.create',
      'user.role.assign',
    ]);
  });

  it('leaves the page writable for an account within the viewer', () => {
    expect(lackedCodes(admin, ['user.read'])).toEqual([]);
    expect(lackedCodes(admin, [])).toEqual([]);
  });

  it('offers only roles within the viewer', () => {
    expect(mayGive(admin, { permissionCodes: ['user.read', 'audit.read'] })).toBe(true);
    expect(mayGive(admin, { permissionCodes: ['user.read', 'role.delete'] })).toBe(false);
  });
});
