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
  Query,
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
import type { AccountContext, Paged } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminUsersService } from './admin-users.service';
import type {
  AdminUserListItemResponse,
  AdminUserViewResponse,
} from './dto/admin-user-response.dto';
import {
  AdminUserListItemResponseDto,
  AdminUserResultResponseDto,
  AdminUserViewResponseDto,
} from './dto/admin-user-response.dto';
import {
  CreateStaffUserDto,
  DeactivateUserDto,
  ListUsersQueryDto,
  LockUserDto,
  SetUserRolesDto,
  UpdateUserDto,
  UserIdParamDto,
} from './dto/admin-user.dto';

/**
 * `/admin/users` (api-endpoints-plan §1.6). The permission check is here; identity enforces what
 * only it can know — no escalation, no acting above your own level, the last `SUPER_ADMIN`.
 */
@ApiTags('admin-users')
@UsesUpstream()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @RequirePermission('user.read')
  @NoStore()
  @ApiOperation({ summary: 'List accounts, a page at a time. Erased accounts are placeholders.' })
  @ApiEnvelope(AdminUserListItemResponseDto, { list: 'page' })
  @ZodSerializerDto(AdminUserListItemResponseDto)
  list(
    @Ctx() context: AccountContext,
    @Query() query: ListUsersQueryDto,
  ): Promise<Paged<AdminUserListItemResponse>> {
    return this.users.list(context, query);
  }

  @Get(':id')
  @RequirePermission('user.read')
  @NoStore()
  @ApiOperation({ summary: 'One account, with its devices and live sessions.' })
  @ApiEnvelope(AdminUserViewResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(AdminUserViewResponseDto)
  get(
    @Ctx() context: AccountContext,
    @Param() params: UserIdParamDto,
  ): Promise<AdminUserViewResponse> {
    return this.users.get(context, params.id);
  }

  @Post()
  @RequirePermission('user.create')
  @NoStore()
  @ApiOperation({
    summary: 'Create a staff account with its roles. It holds nothing its creator does not.',
  })
  @ApiEnvelope(AdminUserResultResponseDto)
  @ApiErrors('EMAIL_TAKEN', 'SUPER_ADMIN_NOT_ASSIGNABLE', 'RESOURCE_NOT_FOUND')
  @ZodSerializerDto(AdminUserResultResponseDto)
  create(
    @Ctx() context: AccountContext,
    @Body() body: CreateStaffUserDto,
  ): Promise<AdminUserResultResponseDto> {
    return this.users.create(context, body);
  }

  @Patch(':id')
  @RequirePermission('user.update')
  @NoStore()
  @ApiOperation({ summary: "Change an account's name." })
  @ApiEnvelope(AdminUserResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'INVALID_STATE')
  @ZodSerializerDto(AdminUserResultResponseDto)
  update(
    @Ctx() context: AccountContext,
    @Param() params: UserIdParamDto,
    @Body() body: UpdateUserDto,
  ): Promise<AdminUserResultResponseDto> {
    return this.users.update(context, params.id, body);
  }

  @Put(':id/roles')
  @RequirePermission('user.role.assign')
  @NoStore()
  @ApiOperation({
    summary: "Replace an account's roles. Its tokens are cut off; its sessions stay.",
  })
  @ApiEnvelope(AdminUserResultResponseDto)
  @ApiErrors(
    'SUPER_ADMIN_NOT_ASSIGNABLE',
    'LAST_SUPER_ADMIN',
    'RESOURCE_NOT_FOUND',
    'INVALID_STATE',
  )
  @ZodSerializerDto(AdminUserResultResponseDto)
  setRoles(
    @Ctx() context: AccountContext,
    @Param() params: UserIdParamDto,
    @Body() body: SetUserRolesDto,
  ): Promise<AdminUserResultResponseDto> {
    return this.users.setRoles(context, params.id, body);
  }

  @Post(':id/lock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('user.lock')
  @NoStore()
  @ApiOperation({ summary: 'Lock an account and sign it out everywhere.' })
  @ApiEnvelope(null)
  @ApiErrors('SELF_ACTION_FORBIDDEN', 'LAST_SUPER_ADMIN', 'RESOURCE_NOT_FOUND', 'INVALID_STATE')
  async lock(
    @Ctx() context: AccountContext,
    @Param() params: UserIdParamDto,
    @Body() body: LockUserDto,
  ): Promise<void> {
    await this.users.lock(context, params.id, body);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('user.lock')
  @NoStore()
  @ApiOperation({ summary: 'Clear a lock and its expiry.' })
  @ApiEnvelope(null)
  @ApiErrors('RESOURCE_NOT_FOUND')
  async unlock(@Ctx() context: AccountContext, @Param() params: UserIdParamDto): Promise<void> {
    await this.users.unlock(context, params.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('user.delete')
  @NoStore()
  @ApiOperation({
    summary: 'Deactivate an account. An owner is checked with billing first (ADR 0053).',
  })
  @ApiEnvelope(null)
  @ApiErrors(
    'SELF_ACTION_FORBIDDEN',
    'LAST_SUPER_ADMIN',
    'OWNER_HAS_LIVE_VOUCHERS',
    'RESOURCE_NOT_FOUND',
    'INVALID_STATE',
  )
  async deactivate(
    @Ctx() context: AccountContext,
    @Param() params: UserIdParamDto,
    @Body() body: DeactivateUserDto,
  ): Promise<void> {
    await this.users.deactivate(context, params.id, body);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('user.delete')
  @NoStore()
  @ApiOperation({ summary: 'Undo a deactivation. Nothing elsewhere is revived.' })
  @ApiEnvelope(null)
  @ApiErrors('RESOURCE_NOT_FOUND', 'INVALID_STATE')
  async restore(@Ctx() context: AccountContext, @Param() params: UserIdParamDto): Promise<void> {
    await this.users.restore(context, params.id);
  }

  @Delete(':id/sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('user.lock')
  @NoStore()
  @ApiOperation({ summary: 'Sign an account out everywhere.' })
  @ApiEnvelope(null)
  @ApiErrors('RESOURCE_NOT_FOUND')
  async revokeSessions(
    @Ctx() context: AccountContext,
    @Param() params: UserIdParamDto,
  ): Promise<void> {
    await this.users.revokeSessions(context, params.id);
  }
}
