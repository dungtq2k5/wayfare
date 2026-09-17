// Valid identity RPC messages for the staff console, for stubbed peers in the gateway suites.
import type { Timestamp } from '../generated/google/protobuf/timestamp.pb';
import type { AdminUser, AdminUserDetail } from '../generated/wayfare/identity/admin_user.pb';
import type { AuditLogEntry } from '../generated/wayfare/identity/audit.pb';
import type { Role } from '../generated/wayfare/identity/role.pb';
import { FIXTURE_IDS } from './fixtures';

/** A fixed instant as a proto timestamp. */
export const FIXTURE_TIMESTAMP: Timestamp = { seconds: '1789560000', nanos: 0 };

/** A role id the fixtures use. */
export const FIXTURE_ROLE_ID = '01990000-0000-7000-8000-000000000010';

/** A live account as `AdminUserService` returns it. */
export function adminUserFixture(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: FIXTURE_IDS.user,
    email: 'staff@example.com',
    fullName: 'Staff Member',
    roles: [{ id: FIXTURE_ROLE_ID, code: 'ADMIN', name: 'Admin' }],
    isLocked: false,
    lockedUntil: undefined,
    ownerVerified: false,
    isEmailVerified: false,
    lastLoginAt: undefined,
    deletedAt: undefined,
    createdAt: FIXTURE_TIMESTAMP,
    ...overrides,
  };
}

/** A detail view as `GetUser` returns it. */
export function adminUserDetailFixture(overrides: Partial<AdminUserDetail> = {}): AdminUserDetail {
  return {
    user: adminUserFixture(),
    devicesCount: 1,
    sessions: { live: 2, console: 1, web: 0, mobile: 1 },
    ...overrides,
  };
}

/** A role as `RoleService` returns it. */
export function roleFixture(overrides: Partial<Role> = {}): Role {
  return {
    id: FIXTURE_ROLE_ID,
    code: 'CUSTOM_SUPPORT',
    name: 'Support',
    isSystem: false,
    permissionCodes: ['audit.read', 'user.read'],
    holders: 0,
    ...overrides,
  };
}

/** An audit row as `AuditService` returns it. */
export function auditLogEntryFixture(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: FIXTURE_IDS.event,
    occurredAt: FIXTURE_TIMESTAMP,
    service: 'identity',
    actor: { type: 'USER', userId: FIXTURE_IDS.user },
    action: 'USER_LOCKED',
    resource: { type: 'USER', id: FIXTURE_IDS.user },
    metadataJson: '{"after":{"lockedUntil":null},"reason":"check"}',
    ...overrides,
  };
}
