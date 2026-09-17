import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { AdminUsersService } from './admin-users.service';

/** `wayfare.identity.AdminUserService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.AdminUserServiceControllerMethods()
export class AdminUsersGrpcController implements identityGrpc.AdminUserServiceController {
  constructor(private readonly users: AdminUsersService) {}

  listUsers(
    request: identityGrpc.ListUsersRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ListUsersResponse> {
    return this.users.listUsers(request, unpackCallerContext(metadata));
  }

  getUser(
    request: identityGrpc.GetUserRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.GetUserResponse> {
    return this.users.getUser(request, unpackCallerContext(metadata));
  }

  createStaffUser(
    request: identityGrpc.CreateStaffUserRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.CreateStaffUserResponse> {
    return this.users.createStaffUser(request, unpackCallerContext(metadata));
  }

  updateUser(
    request: identityGrpc.UpdateUserRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.UpdateUserResponse> {
    return this.users.updateUser(request, unpackCallerContext(metadata));
  }

  setUserRoles(
    request: identityGrpc.SetUserRolesRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.SetUserRolesResponse> {
    return this.users.setUserRoles(request, unpackCallerContext(metadata));
  }

  lockUser(
    request: identityGrpc.LockUserRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.LockUserResponse> {
    return this.users.lockUser(request, unpackCallerContext(metadata));
  }

  unlockUser(
    request: identityGrpc.UnlockUserRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.UnlockUserResponse> {
    return this.users.unlockUser(request, unpackCallerContext(metadata));
  }

  deactivateUser(
    request: identityGrpc.DeactivateUserRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.DeactivateUserResponse> {
    return this.users.deactivateUser(request, unpackCallerContext(metadata));
  }

  restoreUser(
    request: identityGrpc.RestoreUserRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RestoreUserResponse> {
    return this.users.restoreUser(request, unpackCallerContext(metadata));
  }

  revokeUserSessions(
    request: identityGrpc.RevokeUserSessionsRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RevokeUserSessionsResponse> {
    return this.users.revokeUserSessions(request, unpackCallerContext(metadata));
  }
}
