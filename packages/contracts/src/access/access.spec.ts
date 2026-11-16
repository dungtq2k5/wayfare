import { describe, expect, it } from 'vitest';
import { compareStrings } from '../common/sorting';
import { SESSION_CLIENT_BY_HEADER, SESSION_CLIENTS, WAYFARE_CLIENTS } from './clients';
import { PERMISSION_CODES, PERMISSION_GROUPS, PERMISSIONS } from './permissions';
import { ADMIN_EXCLUDED_PERMISSIONS, DEFAULT_ROLES, SYSTEM_ROLE_GRANTS, SystemRole } from './roles';

describe('permissions', () => {
  it.each(PERMISSION_CODES)('%s is target.action', (code) => {
    expect(code).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
  });

  it('uses every group', () => {
    const used = new Set(Object.values(PERMISSIONS).map((spec) => spec.group));
    expect([...used].toSorted(compareStrings)).toEqual(
      [...PERMISSION_GROUPS].toSorted(compareStrings),
    );
  });

  it('files each code under its own section', () => {
    expect(PERMISSIONS['user.role.assign'].group).toBe('ROLES');
    expect(PERMISSIONS['user.email.recover.open'].group).toBe('ACCOUNT_RECOVERY');
    expect(PERMISSIONS['pronunciation.manage'].group).toBe('NARRATION');
    expect(PERMISSIONS['voucher_offer.review'].group).toBe('BILLING');
  });
});

describe('system roles', () => {
  it('gives SUPER_ADMIN every code and ADMIN all but the excluded ones', () => {
    expect(SYSTEM_ROLE_GRANTS[SystemRole.SUPER_ADMIN]).toEqual(PERMISSION_CODES);
    const admin = new Set(SYSTEM_ROLE_GRANTS[SystemRole.ADMIN]);
    expect(admin.size).toBe(PERMISSION_CODES.length - ADMIN_EXCLUDED_PERMISSIONS.length);
    for (const code of ADMIN_EXCLUDED_PERMISSIONS) expect(admin.has(code)).toBe(false);
  });

  it('needs two people to recover an owner account', () => {
    const holders = (code: string) =>
      Object.values(SystemRole).filter((role) =>
        (SYSTEM_ROLE_GRANTS[role] as readonly string[]).includes(code),
      );
    expect(holders('user.email.recover.open')).toEqual([SystemRole.SUPER_ADMIN, SystemRole.ADMIN]);
    expect(holders('user.email.recover.approve')).toEqual([SystemRole.SUPER_ADMIN]);
  });

  it('gives owners the portal and tourists nothing', () => {
    expect(SYSTEM_ROLE_GRANTS[SystemRole.VENUE_OWNER]).toEqual(['owner.access']);
    expect(SYSTEM_ROLE_GRANTS[SystemRole.USER]).toEqual([]);
  });

  it('seeds a content moderator with twelve codes', () => {
    expect(new Set(DEFAULT_ROLES.CONTENT_MODERATOR).size).toBe(12);
  });
});

describe('session clients', () => {
  it('maps every header value to a distinct stored value', () => {
    const stored = WAYFARE_CLIENTS.map((client) => SESSION_CLIENT_BY_HEADER[client]);
    expect(stored.toSorted(compareStrings)).toEqual([...SESSION_CLIENTS].toSorted(compareStrings));
  });
});
