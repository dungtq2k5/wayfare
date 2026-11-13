import { Injectable } from '@nestjs/common';
import type { AccountContext } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import type {
  PermissionGroupResponseDto,
  RoleResponseDto,
  RoleResultResponseDto,
} from './dto/role-response.dto';
import type { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './dto/role.dto';
import {
  toCreateRoleRequest,
  toPermissionGroupResponseDto,
  toRoleResponseDto,
  toUpdateRoleRequest,
} from './role.mapper';

/** `/admin/roles` and `/admin/permissions`, backed by `identity.RoleService`. */
@Injectable()
export class RolesService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async list(context: AccountContext): Promise<RoleResponseDto[]> {
    const response = await this.identity.roles.call('listRoles', {}, context);
    return response.roles.map(toRoleResponseDto);
  }

  async create(context: AccountContext, body: CreateRoleDto): Promise<RoleResultResponseDto> {
    const response = await this.identity.roles.call(
      'createRole',
      toCreateRoleRequest(body),
      context,
    );
    return { role: toRoleResponseDto(response.role) };
  }

  async update(
    context: AccountContext,
    roleId: string,
    body: UpdateRoleDto,
  ): Promise<RoleResultResponseDto> {
    const response = await this.identity.roles.call(
      'updateRole',
      toUpdateRoleRequest(roleId, body),
      context,
    );
    return { role: toRoleResponseDto(response.role) };
  }

  async setPermissions(
    context: AccountContext,
    roleId: string,
    body: SetRolePermissionsDto,
  ): Promise<RoleResultResponseDto> {
    const response = await this.identity.roles.call(
      'setRolePermissions',
      { roleId, permissionCodes: body.permissionCodes },
      context,
    );
    return { role: toRoleResponseDto(response.role) };
  }

  async delete(context: AccountContext, roleId: string): Promise<void> {
    await this.identity.roles.call('deleteRole', { roleId }, context);
  }

  async permissions(context: AccountContext): Promise<PermissionGroupResponseDto[]> {
    const response = await this.identity.roles.call('listPermissions', {}, context);
    return response.groups.map(toPermissionGroupResponseDto);
  }
}
