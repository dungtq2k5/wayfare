import { PERMISSION_CODES } from './permissions';
import type { PermissionCode } from './permissions';

/** Roles whose grants are code, not data — rdm-spec I-4 `is_system`. */
export enum SystemRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  VENUE_OWNER = 'VENUE_OWNER',
  USER = 'USER',
}

/** Every `SystemRole` value. */
export const SYSTEM_ROLES = Object.values(SystemRole);

/**
 * What `ADMIN` does not get — the operations that change who can do what, who controls an
 * account, or move money (api-endpoints-plan §11).
 */
export const ADMIN_EXCLUDED_PERMISSIONS = [
  'role.create',
  'role.update',
  'role.delete',
  'user.role.assign',
  'user.email.recover.approve',
  'billing.plan.manage',
  'billing.entitlement.override',
  'billing.refund.create',
] as const satisfies readonly PermissionCode[];

// Widened so `includes` accepts any code; the list's own type stays exact.
const adminExcluded: readonly string[] = ADMIN_EXCLUDED_PERMISSIONS;

/** Each system role's grants (api-endpoints-plan §11). Read-only over HTTP. */
export const SYSTEM_ROLE_GRANTS: Readonly<Record<SystemRole, readonly PermissionCode[]>> = {
  [SystemRole.SUPER_ADMIN]: PERMISSION_CODES,
  [SystemRole.ADMIN]: PERMISSION_CODES.filter((code) => !adminExcluded.includes(code)),
  [SystemRole.VENUE_OWNER]: ['owner.access'],
  // Every tourist route is `DEVICE` or `USER`, not a permission.
  [SystemRole.USER]: [],
};

/** Seeded, editable roles — not system roles; an admin may change or delete them (api-endpoints-plan §11). */
export const DEFAULT_ROLES = {
  CONTENT_MODERATOR: [
    'submission.read',
    'submission.review',
    'place.read',
    'place.update',
    'place.editorial.update',
    'place.publish',
    'owner_registration.read',
    'owner_registration.review',
    'voucher_offer.review',
    'pronunciation.manage',
    'narration.job.read',
    'localization.edit',
  ],
} as const satisfies Record<string, readonly PermissionCode[]>;
