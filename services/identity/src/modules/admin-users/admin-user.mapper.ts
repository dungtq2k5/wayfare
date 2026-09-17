import { compareStrings } from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import { isLockActive } from '../users/domain/account-state';

/** An account as the console reads it (rdm-spec I-1, I-6). */
export const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  isLocked: true,
  lockedUntil: true,
  lockReason: true,
  ownerVerifiedAt: true,
  isEmailVerified: true,
  lastLoginAt: true,
  deletedAt: true,
  erasedAt: true,
  createdAt: true,
  roles: { select: { role: { select: { id: true, code: true, name: true } } } },
} as const satisfies Prisma.UserSelect;

/** An account as `ADMIN_USER_SELECT` loads it. */
export type AdminUserRow = Prisma.UserGetPayload<{ select: typeof ADMIN_USER_SELECT }>;

/** What the detail view adds to a row. */
export interface AdminUserExtrasRow {
  readonly devicesCount: number;
  readonly sessions: identityGrpc.SessionSummary;
}

/** A live account. `isLocked` is the lock as it holds now, so a lapsed lock reads unlocked. */
export function toAdminUser(row: AdminUserRow, now: Date): identityGrpc.AdminUser {
  const locked = isLockActive(row, now);
  return {
    id: row.id,
    email: row.email,
    ...(row.fullName === null ? {} : { fullName: row.fullName }),
    roles: row.roles
      .map(({ role }) => ({ id: role.id, code: role.code, name: role.name }))
      .toSorted((a, b) => compareStrings(a.code, b.code)),
    isLocked: locked,
    lockedUntil: locked && row.lockedUntil !== null ? toProtoTimestamp(row.lockedUntil) : undefined,
    ownerVerified: row.ownerVerifiedAt !== null,
    isEmailVerified: row.isEmailVerified,
    lastLoginAt: row.lastLoginAt === null ? undefined : toProtoTimestamp(row.lastLoginAt),
    deletedAt: row.deletedAt === null ? undefined : toProtoTimestamp(row.deletedAt),
    createdAt: toProtoTimestamp(row.createdAt),
  };
}

/** An erased account: its id and when, nothing else (ADR 0048). */
export function toErasedUser(row: AdminUserRow & { erasedAt: Date }): identityGrpc.ErasedUser {
  return { id: row.id, erasedAt: toProtoTimestamp(row.erasedAt) };
}

/** One list row: the placeholder for an erased account, the account otherwise. */
export function toAdminUserListItem(row: AdminUserRow, now: Date): identityGrpc.AdminUserListItem {
  return row.erasedAt === null
    ? { user: toAdminUser(row, now) }
    : { erased: toErasedUser({ ...row, erasedAt: row.erasedAt }) };
}

/** The detail view of a live account; the lock reason is staff-only (rdm-spec I-1). */
export function toAdminUserDetail(
  row: AdminUserRow,
  extras: AdminUserExtrasRow,
  now: Date,
): identityGrpc.AdminUserDetail {
  const user = toAdminUser(row, now);
  return {
    user,
    devicesCount: extras.devicesCount,
    sessions: extras.sessions,
    ...(user.isLocked && row.lockReason !== null ? { lockReason: row.lockReason } : {}),
  };
}
