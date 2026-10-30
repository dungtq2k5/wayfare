import { compareStrings } from '@wayfare/contracts';
import type { OwnerRegistrationStatus } from '@wayfare/contracts';
import { accountKindProto, ownerRegistrationStatusProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import { isLockActive } from '../users/domain/account-state';
import { kindOf } from './domain/account-kind';

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
  // The latest application, for the list's status and the page's summary (rdm-spec I-8).
  ownerRegistrations: {
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { status: true, submittedAt: true, reviewedAt: true },
  },
} as const satisfies Prisma.UserSelect;

/** An account as `ADMIN_USER_SELECT` loads it. */
export type AdminUserRow = Prisma.UserGetPayload<{ select: typeof ADMIN_USER_SELECT }>;

/** What the detail view adds to a row. */
export interface AdminUserExtrasRow {
  readonly devicesCount: number;
  readonly sessions: identityGrpc.SessionSummary;
  /** The union of the account's roles' live codes. */
  readonly permissionCodes: readonly string[];
  readonly passwordSet: boolean;
  readonly googleEmail: string | null;
  readonly preferredLocale: string;
  readonly devicesLastSeenAt: Date | null;
}

/** A live account. `isLocked` is the lock as it holds now, so a lapsed lock reads unlocked. */
export function toAdminUser(row: AdminUserRow, now: Date): identityGrpc.AdminUser {
  const locked = isLockActive(row, now);
  const latest = row.ownerRegistrations[0];
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
    kind: accountKindProto.toProto(kindOf(row.roles.map(({ role }) => role.code))),
    ...(latest === undefined
      ? {}
      : {
          ownerRegistrationStatus: ownerRegistrationStatusProto.toProto(
            latest.status as OwnerRegistrationStatus,
          ),
        }),
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
  const latest = row.ownerRegistrations[0];
  return {
    user,
    devicesCount: extras.devicesCount,
    sessions: extras.sessions,
    ...(user.isLocked && row.lockReason !== null ? { lockReason: row.lockReason } : {}),
    permissionCodes: [...extras.permissionCodes],
    passwordSet: extras.passwordSet,
    ...(extras.googleEmail === null ? {} : { googleEmail: extras.googleEmail }),
    preferredLocale: extras.preferredLocale,
    devicesLastSeenAt:
      extras.devicesLastSeenAt === null ? undefined : toProtoTimestamp(extras.devicesLastSeenAt),
    ownerRegistration:
      latest === undefined
        ? undefined
        : {
            status: ownerRegistrationStatusProto.toProto(latest.status as OwnerRegistrationStatus),
            submittedAt: toProtoTimestamp(latest.submittedAt),
            reviewedAt:
              latest.reviewedAt === null ? undefined : toProtoTimestamp(latest.reviewedAt),
          },
  };
}
