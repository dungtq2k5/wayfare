import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { RolesService } from './roles.service';

/** `wayfare.identity.RoleService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.RoleServiceControllerMethods()
export class RolesGrpcController implements identityGrpc.RoleServiceController {
  constructor(private readonly roles: RolesService) {}

  listRoles(
    _request: identityGrpc.ListRolesRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ListRolesResponse> {
    return this.roles.listRoles(unpackCallerContext(metadata));
  }

  createRole(
    request: identityGrpc.CreateRoleRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.CreateRoleResponse> {
    return this.roles.createRole(request, unpackCallerContext(metadata));
  }

  updateRole(
    request: identityGrpc.UpdateRoleRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.UpdateRoleResponse> {
    return this.roles.updateRole(request, unpackCallerContext(metadata));
  }

  setRolePermissions(
    request: identityGrpc.SetRolePermissionsRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.SetRolePermissionsResponse> {
    return this.roles.setRolePermissions(request, unpackCallerContext(metadata));
  }

  deleteRole(
    request: identityGrpc.DeleteRoleRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.DeleteRoleResponse> {
    return this.roles.deleteRole(request, unpackCallerContext(metadata));
  }

  listPermissions(
    _request: identityGrpc.ListPermissionsRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ListPermissionsResponse> {
    return this.roles.listPermissions(unpackCallerContext(metadata));
  }
}
