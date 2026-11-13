import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  Ctx,
  NoStore,
  RequirePermission,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  PermissionGroupResponseDto,
  RoleResponseDto,
  RoleResultResponseDto,
} from './dto/role-response.dto';
import {
  CreateRoleDto,
  RoleIdParamDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { RolesService } from './roles.service';

/**
 * `/admin/roles` and `/admin/permissions` (api-endpoints-plan §1.6) — one controller, so the
 * catalogue read lives beside the role editor. System roles are read-only.
 */
@ApiTags('admin-roles')
@UsesUpstream()
@Controller('admin')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  @RequirePermission('role.read')
  @NoStore()
  @ApiOperation({ summary: 'Every role, with its permission codes and live holders.' })
  @ApiEnvelope(RoleResponseDto, { array: true })
  @ZodSerializerDto([RoleResponseDto])
  list(@Ctx() context: AccountContext): Promise<RoleResponseDto[]> {
    return this.roles.list(context);
  }

  @Post('roles')
  @RequirePermission('role.create')
  @NoStore()
  @ApiOperation({ summary: 'Create a custom role. Its code is generated and never changes.' })
  @ApiEnvelope(RoleResultResponseDto)
  @ApiErrors('ROLE_NAME_TAKEN', 'PERMISSION_RETIRED')
  @ZodSerializerDto(RoleResultResponseDto)
  create(
    @Ctx() context: AccountContext,
    @Body() body: CreateRoleDto,
  ): Promise<RoleResultResponseDto> {
    return this.roles.create(context, body);
  }

  @Patch('roles/:id')
  @RequirePermission('role.update')
  @NoStore()
  @ApiOperation({ summary: 'Rename or re-describe a custom role.' })
  @ApiEnvelope(RoleResultResponseDto)
  @ApiErrors('SYSTEM_ROLE_READ_ONLY', 'ROLE_NAME_TAKEN', 'RESOURCE_NOT_FOUND')
  @ZodSerializerDto(RoleResultResponseDto)
  update(
    @Ctx() context: AccountContext,
    @Param() params: RoleIdParamDto,
    @Body() body: UpdateRoleDto,
  ): Promise<RoleResultResponseDto> {
    return this.roles.update(context, params.id, body);
  }

  @Put('roles/:id/permissions')
  @RequirePermission('role.update')
  @NoStore()
  @ApiOperation({
    summary: "Replace a custom role's permissions. Every holder's tokens are cut off.",
  })
  @ApiEnvelope(RoleResultResponseDto)
  @ApiErrors(
    'SYSTEM_ROLE_READ_ONLY',
    'PERMISSION_RETIRED',
    'ROLE_TOO_WIDE_TO_EDIT',
    'RESOURCE_NOT_FOUND',
  )
  @ZodSerializerDto(RoleResultResponseDto)
  setPermissions(
    @Ctx() context: AccountContext,
    @Param() params: RoleIdParamDto,
    @Body() body: SetRolePermissionsDto,
  ): Promise<RoleResultResponseDto> {
    return this.roles.setPermissions(context, params.id, body);
  }

  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('role.delete')
  @NoStore()
  @ApiOperation({ summary: 'Delete a custom role nobody holds.' })
  @ApiEnvelope(null)
  @ApiErrors('SYSTEM_ROLE_READ_ONLY', 'ROLE_IN_USE', 'RESOURCE_NOT_FOUND')
  async delete(@Ctx() context: AccountContext, @Param() params: RoleIdParamDto): Promise<void> {
    await this.roles.delete(context, params.id);
  }

  @Get('permissions')
  @RequirePermission('role.read')
  @NoStore()
  @ApiOperation({ summary: 'The permission catalogue by group, retired codes included.' })
  @ApiEnvelope(PermissionGroupResponseDto, { array: true })
  @ZodSerializerDto([PermissionGroupResponseDto])
  permissions(@Ctx() context: AccountContext): Promise<PermissionGroupResponseDto[]> {
    return this.roles.permissions(context);
  }
}
