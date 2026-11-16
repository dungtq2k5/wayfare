/** Console sections permissions are grouped under — UI keys, translated by the console bundle. */
export const PERMISSION_GROUPS = [
  'OWNER',
  'USERS',
  'ROLES',
  'AUDIT',
  'OWNER_REGISTRATIONS',
  'ACCOUNT_RECOVERY',
  'CATALOG',
  'SUBMISSIONS',
  'NARRATION',
  'BILLING',
  'ANALYTICS',
] as const;

/** A permission group. */
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

/** One permission (api-endpoints-plan §11, ADR 0044). */
export interface PermissionSpec {
  readonly group: PermissionGroup;
  /** English, for the seeded I-5 row. The console shows its bundle's `permission.<code>` text instead. */
  readonly description: string;
}

/**
 * Every permission, in api-endpoints-plan §11's order — the single source of truth (ADR 0044). The
 * seeder mirrors it into rdm-spec I-5.
 */
export const PERMISSIONS = {
  'owner.access': { group: 'OWNER', description: 'Use the owner portal.' },

  'user.read': { group: 'USERS', description: 'View accounts.' },
  'user.create': { group: 'USERS', description: 'Create staff accounts.' },
  'user.update': { group: 'USERS', description: 'Edit accounts.' },
  'user.delete': { group: 'USERS', description: 'Deactivate and restore accounts.' },
  'user.lock': {
    group: 'USERS',
    description: 'Lock and unlock accounts, and revoke their sessions.',
  },
  'user.role.assign': { group: 'ROLES', description: "Change an account's roles." },
  'role.read': { group: 'ROLES', description: 'View roles and their permissions.' },
  'role.create': { group: 'ROLES', description: 'Create roles.' },
  'role.update': { group: 'ROLES', description: 'Edit roles and their permissions.' },
  'role.delete': { group: 'ROLES', description: 'Delete roles.' },
  'audit.read': { group: 'AUDIT', description: 'Read the audit log.' },

  'owner_registration.read': {
    group: 'OWNER_REGISTRATIONS',
    description: 'View owner registrations.',
  },
  'owner_registration.review': {
    group: 'OWNER_REGISTRATIONS',
    description: 'Approve or reject owner registrations.',
  },
  'owner_registration.pii.read': {
    group: 'OWNER_REGISTRATIONS',
    description: "Reveal an applicant's national ID.",
  },
  'user.email.recover.open': {
    group: 'ACCOUNT_RECOVERY',
    description: 'Open an owner account recovery.',
  },
  'user.email.recover.approve': {
    group: 'ACCOUNT_RECOVERY',
    description: "Approve another admin's account recovery.",
  },

  'place.read': { group: 'CATALOG', description: 'View every Place, in any status.' },
  'place.create': { group: 'CATALOG', description: 'Create editorial Places.' },
  'place.update': { group: 'CATALOG', description: 'Edit Places.' },
  'place.editorial.update': {
    group: 'CATALOG',
    description: "Set a Place's trigger radius and narration priority.",
  },
  'place.publish': { group: 'CATALOG', description: 'Activate and deactivate Places.' },
  'place.delete': { group: 'CATALOG', description: 'Delete and restore Places.' },
  'submission.read': { group: 'SUBMISSIONS', description: 'View owner submissions.' },
  'submission.review': {
    group: 'SUBMISSIONS',
    description: 'Approve or reject owner submissions.',
  },
  'tour.manage': { group: 'CATALOG', description: 'Create, edit and publish Tours.' },
  'catalog.taxonomy.manage': { group: 'CATALOG', description: 'Manage categories and areas.' },
  'map_pack.manage': { group: 'CATALOG', description: 'Register and publish offline map packs.' },

  'narration.job.read': { group: 'NARRATION', description: 'View synthesis jobs.' },
  'narration.job.manage': {
    group: 'NARRATION',
    description: 'Start, pause, resume, cancel and retry synthesis jobs.',
  },
  'pronunciation.manage': { group: 'NARRATION', description: 'Edit the pronunciation dictionary.' },
  'localization.edit': { group: 'NARRATION', description: 'Correct and revert translations.' },

  'billing.plan.manage': { group: 'BILLING', description: 'Create, edit and retire plans.' },
  'billing.account.read': { group: 'BILLING', description: 'View billing accounts.' },
  'billing.entitlement.override': {
    group: 'BILLING',
    description: "Override and unpin an owner's entitlements.",
  },
  'billing.order.read': { group: 'BILLING', description: 'View orders and vouchers.' },
  'billing.refund.create': { group: 'BILLING', description: 'Issue refunds.' },
  'billing.event.read': { group: 'BILLING', description: 'View and replay Stripe webhook events.' },
  'voucher_offer.review': { group: 'BILLING', description: 'Approve or reject voucher offers.' },

  'analytics.read': { group: 'ANALYTICS', description: 'View platform analytics.' },
} as const satisfies Record<string, PermissionSpec>;

/** A permission code, `target.action` (conventions §15). */
export type PermissionCode = keyof typeof PERMISSIONS;

/** Every permission code, in registry order. */
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

/** True when `value` is a known permission code. */
export function isPermissionCode(value: unknown): value is PermissionCode {
  return typeof value === 'string' && Object.hasOwn(PERMISSIONS, value);
}
