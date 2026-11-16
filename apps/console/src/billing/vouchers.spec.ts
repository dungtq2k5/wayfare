import { AUDIT_RESOURCE_TYPES } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { auditActionShown, auditResourceShown, permissionShown } from './vouchers';

describe('the voucher chain hidden from staff while it is deferred (ADR 0066)', () => {
  it('hides its two permissions from the roles grid, and only those', () => {
    expect(permissionShown('billing.order.read')).toBe(false);
    expect(permissionShown('voucher_offer.review')).toBe(false);
    expect(permissionShown('billing.account.read')).toBe(true);
    expect(permissionShown('voucher_offer.review', true)).toBe(true);
  });

  it('hides its actions and resources from the audit filters', () => {
    expect(['VOUCHER_OFFER', 'ORDER', 'VOUCHER'].map((type) => auditResourceShown(type))).toEqual([
      false,
      false,
      false,
    ]);
    expect(AUDIT_RESOURCE_TYPES.filter((type) => auditResourceShown(type))).toContain('PLAN');
    expect(auditActionShown('VOUCHER_REDEEMED')).toBe(false);
    expect(auditActionShown('ORDER_PAID')).toBe(false);
    expect(auditActionShown('ENTITLEMENTS_OVERRIDDEN')).toBe(true);
    expect(auditActionShown('UNKNOWN_FROM_A_NEWER_API')).toBe(true);
    expect(auditActionShown('VOUCHER_REDEEMED', true)).toBe(true);
    expect(auditResourceShown('VOUCHER', true)).toBe(true);
  });
});
