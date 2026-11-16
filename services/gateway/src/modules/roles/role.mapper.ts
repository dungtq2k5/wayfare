import type { identityGrpc } from '@wayfare/contracts/grpc';
import type { PermissionGroupResponseDto, RoleResponseDto } from './dto/role-response.dto';
import type { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

/** A role, field by field; an absent description becomes `null`. */
export function toRoleResponseDto(role: identityGrpc.Role | undefined | null): RoleResponseDto {
  if (role === undefined || role === null) throw new Error('A response arrived without its role');
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description ?? null,
    isSystem: role.isSystem,
    permissionCodes: [...role.permissionCodes],
    holders: role.holders,
  };
}

/** One catalogue section. */
export function toPermissionGroupResponseDto(
  group: identityGrpc.PermissionGroupView,
): PermissionGroupResponseDto {
  return {
    group: group.group,
    permissions: group.permissions.map((permission) => ({
      code: permission.code,
      description: permission.description,
      isRetired: permission.isRetired,
    })),
  };
}

/** The `CreateRole` request. */
export function toCreateRoleRequest(body: CreateRoleDto): identityGrpc.CreateRoleRequest {
  return {
    name: body.name,
    ...(body.description === undefined ? {} : { description: body.description }),
    permissionCodes: body.permissionCodes,
  };
}

/** The `UpdateRole` request: `description: null` travels as the empty string, which clears it. */
export function toUpdateRoleRequest(
  roleId: string,
  body: UpdateRoleDto,
): identityGrpc.UpdateRoleRequest {
  return {
    roleId,
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.description === undefined ? {} : { description: body.description ?? '' }),
  };
}
