import { describe, expect, it } from 'vitest';
import { AUDIT_METADATA_ALLOWLIST } from '../audit/allowlist';
import { zAuditActionFilter } from '../audit/filters';
import { AuditAction } from '../audit/vocabulary';
import { errorDetailsSchema } from '../errors/registry';
import { SESSION_REVOKED_REASONS } from './enums';
import { MAX_ROLE_CODE_LENGTH } from './limits';
import { TOKEN_REVOCATION_REASONS, TokenRevocationReason } from './revocation';
import { roleCodeCandidates, roleCodeFromName } from './role-code';

describe('roleCodeFromName', () => {
  it.each([
    ['Đặng Bảo', 'CUSTOM_DANG_BAO'],
    ['Hỗ trợ khách hàng', 'CUSTOM_HO_TRO_KHACH_HANG'],
    ['  support -- team  ', 'CUSTOM_SUPPORT_TEAM'],
    ['!!!', 'CUSTOM_ROLE'],
    ['日本', 'CUSTOM_ROLE'],
  ])('%s → %s', (name, code) => {
    expect(roleCodeFromName(name)).toBe(code);
  });

  it('cuts a long name to a 22-character base, never ending in an underscore', () => {
    const code = roleCodeFromName('a'.repeat(60));
    expect(code).toBe(`CUSTOM_${'A'.repeat(22)}`);
    expect(roleCodeFromName(`${'a'.repeat(21)} b`)).toBe(`CUSTOM_${'A'.repeat(21)}`);
  });
});

describe('roleCodeCandidates', () => {
  it('tries the code, then _2 to _99, each within the column', () => {
    const base = roleCodeFromName('x'.repeat(60));
    const candidates = [...roleCodeCandidates(base)];
    expect(candidates).toHaveLength(99);
    expect(candidates.slice(0, 3)).toEqual([base, `${base}_2`, `${base}_3`]);
    expect(candidates.at(-1)).toBe(`${base}_99`);
    for (const candidate of candidates)
      expect(candidate.length).toBeLessThanOrEqual(MAX_ROLE_CODE_LENGTH);
  });
});

describe('TokenRevocationReason', () => {
  it('is every session reason plus PERMISSIONS_CHANGED', () => {
    expect(TOKEN_REVOCATION_REASONS).toEqual(
      expect.arrayContaining([...SESSION_REVOKED_REASONS, 'PERMISSIONS_CHANGED']),
    );
    expect(TOKEN_REVOCATION_REASONS).toHaveLength(SESSION_REVOKED_REASONS.length + 1);
    expect(TokenRevocationReason.PERMISSIONS_CHANGED).toBe('PERMISSIONS_CHANGED');
  });
});

describe('staff administration error details', () => {
  it.each([
    ['ROLE_IN_USE', { holders: 2 }, { holders: 0 }],
    ['ROLE_TOO_WIDE_TO_EDIT', { holders: 501, limit: 500 }, { holders: 501 }],
    ['PERMISSION_RETIRED', { codes: ['user.read'] }, { codes: [] }],
    [
      'OWNER_HAS_LIVE_VOUCHERS',
      { issuedVoucherCount: 3, openCheckoutCount: 0 },
      { issuedVoucherCount: 3 },
    ],
  ] as const)('%s accepts its details and refuses a bad shape', (code, good, bad) => {
    const schema = errorDetailsSchema(code);
    expect(schema?.safeParse(good).success).toBe(true);
    expect(schema?.safeParse(bad).success).toBe(false);
  });

  it('the codes without details send none', () => {
    for (const code of [
      'SUPER_ADMIN_NOT_ASSIGNABLE',
      'LAST_SUPER_ADMIN',
      'SELF_ACTION_FORBIDDEN',
      'SYSTEM_ROLE_READ_ONLY',
      'ROLE_NAME_TAKEN',
    ] as const) {
      expect(errorDetailsSchema(code)).toBeUndefined();
    }
  });
});

describe('staff administration audit allowlists', () => {
  it.each([
    AuditAction.STAFF_USER_CREATED,
    AuditAction.USER_UPDATED,
    AuditAction.USER_ROLES_UPDATED,
    AuditAction.USER_LOCKED,
    AuditAction.USER_UNLOCKED,
    AuditAction.USER_DEACTIVATED,
    AuditAction.USER_SESSIONS_REVOKED,
    AuditAction.ROLE_CREATED,
    AuditAction.ROLE_UPDATED,
    AuditAction.ROLE_PERMISSIONS_UPDATED,
    AuditAction.ROLE_DELETED,
  ])('%s records something, and never an address or a person', (action) => {
    const allowlist = AUDIT_METADATA_ALLOWLIST[action];
    const fields = [...(allowlist.before ?? []), ...(allowlist.after ?? [])];
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) expect(field).not.toMatch(/email|fullName|phone/i);
  });

  it('only a lock and a deactivation carry a reason', () => {
    expect(AUDIT_METADATA_ALLOWLIST[AuditAction.USER_LOCKED].reason).toBe(true);
    expect(AUDIT_METADATA_ALLOWLIST[AuditAction.USER_DEACTIVATED].reason).toBe(true);
    expect(AUDIT_METADATA_ALLOWLIST[AuditAction.USER_RESTORED]).toEqual({});
  });
});

describe('zAuditActionFilter', () => {
  it('takes any upper-snake action up to 64 characters', () => {
    expect(zAuditActionFilter.safeParse('USER_LOCKED').success).toBe(true);
    expect(zAuditActionFilter.safeParse('RETIRED_LONG_AGO').success).toBe(true);
    expect(zAuditActionFilter.safeParse('user_locked').success).toBe(false);
    expect(zAuditActionFilter.safeParse(`A${'B'.repeat(64)}`).success).toBe(false);
  });
});
