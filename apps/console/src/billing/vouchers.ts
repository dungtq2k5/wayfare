import { AUDIT_ACTION_RESOURCE, AuditResourceType, VOUCHERS_AVAILABLE } from '@wayfare/contracts';
import type { AuditAction } from '@wayfare/contracts';

/** The permissions only the voucher chain uses. */
const VOUCHER_PERMISSIONS: ReadonlySet<string> = new Set([
  'billing.order.read',
  'voucher_offer.review',
]);

/** The audit resources only the voucher chain writes: offers, their orders, the vouchers. */
const VOUCHER_RESOURCES: ReadonlySet<string> = new Set([
  AuditResourceType.VOUCHER_OFFER,
  AuditResourceType.ORDER,
  AuditResourceType.VOUCHER,
]);

/**
 * Whether the roles grid lists a permission: the voucher chain's are hidden while vouchers aren't
 * sold (ADR 0066). They stay in the registry and on the roles that hold them.
 */
export const permissionShown = (code: string, available = VOUCHERS_AVAILABLE): boolean =>
  available || !VOUCHER_PERMISSIONS.has(code);

/** Whether the audit log's *Resource* filter lists a resource: no voucher row can occur yet. */
export const auditResourceShown = (type: string, available = VOUCHERS_AVAILABLE): boolean =>
  available || !VOUCHER_RESOURCES.has(type);

/** Whether the audit log's *Action* filter lists an action: not the voucher resources' ones. */
export const auditActionShown = (code: string, available = VOUCHERS_AVAILABLE): boolean =>
  auditResourceShown(AUDIT_ACTION_RESOURCE[code as AuditAction] ?? '', available);
