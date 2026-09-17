import {
  emailBounceTypeProto,
  emailDeliveryStatusProto,
  emailTemplateProto,
} from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  fromOptionalProtoTimestamp,
  fromProtoTimestamp,
  toProtoTimestamp,
} from '@wayfare/nest-common';
import type {
  AdminUserListItemResponse,
  AdminUserResponseDto,
  AdminUserViewResponse,
  EmailDeliveryResponseDto,
} from './dto/admin-user-response.dto';
import type { DeactivateUserDto, ListUsersQueryDto, LockUserDto } from './dto/admin-user.dto';

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

/** An account, field by field; an absent optional becomes `null` (conventions §6.3). */
export function toAdminUserResponseDto(
  user: identityGrpc.AdminUser | undefined | null,
): AdminUserResponseDto {
  if (user === undefined || user === null) throw new Error('A response arrived without its user');
  return {
    erased: false,
    id: user.id,
    email: user.email,
    fullName: user.fullName ?? null,
    roles: user.roles.map((role) => ({ id: role.id, code: role.code, name: role.name })),
    isLocked: user.isLocked,
    lockedUntil: iso(fromOptionalProtoTimestamp(user.lockedUntil, 'lockedUntil')),
    ownerVerified: user.ownerVerified,
    isEmailVerified: user.isEmailVerified,
    lastLoginAt: iso(fromOptionalProtoTimestamp(user.lastLoginAt, 'lastLoginAt')),
    deletedAt: iso(fromOptionalProtoTimestamp(user.deletedAt, 'deletedAt')),
    createdAt: fromProtoTimestamp(user.createdAt, 'createdAt').toISOString(),
  };
}

/** One list row: the placeholder for an erased account, the account otherwise. */
export function toAdminUserListItemResponse(
  item: identityGrpc.AdminUserListItem,
): AdminUserListItemResponse {
  if (item.erased !== undefined && item.erased !== null) {
    return {
      erased: true,
      id: item.erased.id,
      erasedAt: fromProtoTimestamp(item.erased.erasedAt, 'erasedAt').toISOString(),
    };
  }
  return toAdminUserResponseDto(item.user);
}

/** The detail view, or the erased placeholder. */
export function toAdminUserViewResponse(
  response: identityGrpc.GetUserResponse,
): AdminUserViewResponse {
  if (response.erased !== undefined && response.erased !== null) {
    return {
      erased: true,
      id: response.erased.id,
      erasedAt: fromProtoTimestamp(response.erased.erasedAt, 'erasedAt').toISOString(),
    };
  }
  const detail = response.user;
  if (detail === undefined || detail === null) throw new Error('GetUser returned nothing');
  const sessions = detail.sessions;
  return {
    ...toAdminUserResponseDto(detail.user),
    devicesCount: detail.devicesCount,
    sessions: {
      live: sessions?.live ?? 0,
      byClient: {
        CONSOLE: sessions?.console ?? 0,
        WEB: sessions?.web ?? 0,
        MOBILE: sessions?.mobile ?? 0,
      },
    },
    lockReason: detail.lockReason ?? null,
    ownerRegistration: null,
  };
}

/** The `ListUsers` request. Absent filters stay absent. */
export function toListUsersRequest(query: ListUsersQueryDto): identityGrpc.ListUsersRequest {
  return {
    page: {
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      ...(query.q === undefined ? {} : { q: query.q }),
    },
    ...(query.roleId === undefined ? {} : { roleId: query.roleId }),
    ...(query.isLocked === undefined ? {} : { isLocked: query.isLocked }),
    ...(query.ownerVerified === undefined ? {} : { ownerVerified: query.ownerVerified }),
    includeDeleted: query.includeDeleted ?? false,
  };
}

/** The `LockUser` request; no expiry means an indefinite lock. */
export function toLockUserRequest(userId: string, body: LockUserDto): identityGrpc.LockUserRequest {
  return {
    userId,
    reason: body.reason,
    lockedUntil:
      body.lockedUntil === undefined ? undefined : toProtoTimestamp(new Date(body.lockedUntil)),
  };
}

/** The `DeactivateUser` request. */
export function toDeactivateUserRequest(
  userId: string,
  body: DeactivateUserDto,
): identityGrpc.DeactivateUserRequest {
  return {
    userId,
    reason: body.reason,
    refundUnredeemedVouchers: body.refundUnredeemedVouchers ?? false,
  };
}

/** One send. An enum this build cannot read is a server fault; an unset bounce type is `null`. */
export function toEmailDeliveryResponseDto(
  delivery: identityGrpc.EmailDeliveryView,
): EmailDeliveryResponseDto {
  const template = emailTemplateProto.fromProto(delivery.template);
  const status = emailDeliveryStatusProto.fromProto(delivery.status);
  if (template === null || status === null) {
    throw new Error('An email delivery carries an unknown enum value');
  }
  return {
    id: delivery.id,
    template,
    toEmailMasked: delivery.toEmailMasked ?? null,
    status,
    bounceType: emailBounceTypeProto.fromProto(delivery.bounceType),
    statusChangedAt: fromProtoTimestamp(delivery.statusChangedAt, 'statusChangedAt').toISOString(),
    createdAt: fromProtoTimestamp(delivery.createdAt, 'createdAt').toISOString(),
  };
}
