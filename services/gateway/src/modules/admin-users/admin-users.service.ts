import { Injectable, Logger } from '@nestjs/common';
import { subscriptionStatusProto } from '@wayfare/contracts/grpc';
import type { AccountContext } from '@wayfare/nest-common';
import { Paged, toPageMetaOrThrow, WithMeta } from '@wayfare/nest-common';
import { BillingServiceGrpcClient } from '../billing/billing-service-grpc.client';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import {
  toAdminUserListItemResponse,
  toAdminUserResponseDto,
  toAdminUserViewResponse,
  toDeactivateUserRequest,
  toEmailDeliveryResponseDto,
  toListUsersRequest,
  toLockUserRequest,
} from './admin-user.mapper';
import type {
  AdminUserListItemResponse,
  AdminUserResultResponseDto,
  AdminUserViewResponse,
  EmailDeliveryCheckResponseDto,
  EmailDeliveryResponseDto,
} from './dto/admin-user-response.dto';
import type {
  CheckEmailDeliveryDto,
  CreateStaffUserDto,
  DeactivateUserDto,
  ListEmailDeliveriesQueryDto,
  ListUsersQueryDto,
  LockUserDto,
  SetUserRolesDto,
  UpdateUserDto,
} from './dto/admin-user.dto';

/** `/admin/users` routes, backed by `identity.AdminUserService`. */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly identity: IdentityServiceGrpcClient,
    private readonly billing: BillingServiceGrpcClient,
  ) {}

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

  /**
   * One account; an owner's billing row for a viewer holding `billing.account.read`. billing is the
   * secondary service: when it can't answer, `billing` is `null` and `meta.degraded` says so, and
   * the page still loads (api-endpoints-plan §12.1).
   */
  async get(
    context: AccountContext,
    userId: string,
  ): Promise<AdminUserViewResponse | WithMeta<AdminUserViewResponse>> {
    const view = toAdminUserViewResponse(
      await this.identity.adminUsers.call('getUser', { userId }, context),
    );
    if (view.erased) return view;
    if (!view.ownerVerified || !context.permissions.includes('billing.account.read')) {
      return { ...view, billing: null };
    }
    try {
      const summary = await this.billing.billing.call(
        'getBillingSummary',
        { ownerUserId: view.id },
        context,
      );
      const status = subscriptionStatusProto.fromProto(summary.subscriptionStatus);
      if (status === null) throw new Error('billing sent an unknown subscription status');
      return {
        ...view,
        billing: {
          accountId: summary.billingAccountId,
          planCode: summary.planCode,
          subscriptionStatus: status,
        },
      };
    } catch (error) {
      this.logger.warn(
        { kind: error instanceof Error ? error.name : 'unknown' },
        "billing summary unavailable; a user's page degraded",
      );
      return WithMeta.of({ ...view, billing: null }, { degraded: ['billing'] });
    }
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

  async emailDeliveries(
    context: AccountContext,
    userId: string,
    query: ListEmailDeliveriesQueryDto,
  ): Promise<Paged<EmailDeliveryResponseDto>> {
    const response = await this.identity.adminUsers.call(
      'listEmailDeliveries',
      {
        userId,
        page: {
          limit: query.limit,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        },
      },
      context,
    );
    return Paged.cursor(
      response.deliveries.map(toEmailDeliveryResponseDto),
      response.page?.nextCursor ?? null,
    );
  }

  async checkEmailDelivery(
    context: AccountContext,
    userId: string,
    body: CheckEmailDeliveryDto,
  ): Promise<EmailDeliveryCheckResponseDto> {
    const response = await this.identity.adminUsers.call(
      'checkEmailDelivery',
      { userId, email: body.email },
      context,
    );
    return { matches: response.matches };
  }
}
