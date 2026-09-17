import { Injectable } from '@nestjs/common';
import type { AccountContext } from '@wayfare/nest-common';
import { Paged, toPageMetaOrThrow } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import {
  toAdminUserListItemResponse,
  toAdminUserResponseDto,
  toAdminUserViewResponse,
  toDeactivateUserRequest,
  toListUsersRequest,
  toLockUserRequest,
} from './admin-user.mapper';
import type {
  AdminUserListItemResponse,
  AdminUserResultResponseDto,
  AdminUserViewResponse,
} from './dto/admin-user-response.dto';
import type {
  CreateStaffUserDto,
  DeactivateUserDto,
  ListUsersQueryDto,
  LockUserDto,
  SetUserRolesDto,
  UpdateUserDto,
} from './dto/admin-user.dto';

/** `/admin/users` routes, backed by `identity.AdminUserService`. */
@Injectable()
export class AdminUsersService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async list(
    context: AccountContext,
    query: ListUsersQueryDto,
  ): Promise<Paged<AdminUserListItemResponse>> {
    const response = await this.identity.adminUsers.call(
      'listUsers',
      toListUsersRequest(query),
      context,
    );
    const meta = toPageMetaOrThrow(response.page);
    return Paged.page(
      response.users.map(toAdminUserListItemResponse),
      meta.page,
      meta.pageSize,
      meta.total,
    );
  }

  async get(context: AccountContext, userId: string): Promise<AdminUserViewResponse> {
    return toAdminUserViewResponse(
      await this.identity.adminUsers.call('getUser', { userId }, context),
    );
  }

  async create(
    context: AccountContext,
    body: CreateStaffUserDto,
  ): Promise<AdminUserResultResponseDto> {
    const response = await this.identity.adminUsers.call('createStaffUser', body, context);
    return { user: toAdminUserResponseDto(response.user) };
  }

  async update(
    context: AccountContext,
    userId: string,
    body: UpdateUserDto,
  ): Promise<AdminUserResultResponseDto> {
    const response = await this.identity.adminUsers.call(
      'updateUser',
      { userId, ...(body.fullName === undefined ? {} : { fullName: body.fullName }) },
      context,
    );
    return { user: toAdminUserResponseDto(response.user) };
  }

  async setRoles(
    context: AccountContext,
    userId: string,
    body: SetUserRolesDto,
  ): Promise<AdminUserResultResponseDto> {
    const response = await this.identity.adminUsers.call(
      'setUserRoles',
      { userId, roleIds: body.roleIds },
      context,
    );
    return { user: toAdminUserResponseDto(response.user) };
  }

  async lock(context: AccountContext, userId: string, body: LockUserDto): Promise<void> {
    await this.identity.adminUsers.call('lockUser', toLockUserRequest(userId, body), context);
  }

  async unlock(context: AccountContext, userId: string): Promise<void> {
    await this.identity.adminUsers.call('unlockUser', { userId }, context);
  }

  async deactivate(
    context: AccountContext,
    userId: string,
    body: DeactivateUserDto,
  ): Promise<void> {
    await this.identity.adminUsers.call(
      'deactivateUser',
      toDeactivateUserRequest(userId, body),
      context,
    );
  }

  async restore(context: AccountContext, userId: string): Promise<void> {
    await this.identity.adminUsers.call('restoreUser', { userId }, context);
  }

  async revokeSessions(context: AccountContext, userId: string): Promise<void> {
    await this.identity.adminUsers.call('revokeUserSessions', { userId }, context);
  }
}
