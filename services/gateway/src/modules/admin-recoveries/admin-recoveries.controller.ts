import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Recovery } from '@wayfare/contracts';
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
import { AdminRecoveriesService } from './admin-recoveries.service';
import { RecoveryResponseDto, RecoveryResultResponseDto } from './dto/admin-recovery-response.dto';
import {
  OpenRecoveryDto,
  RecoveryIdParamDto,
  RecoveryQueryDto,
  RecoverySubjectParamDto,
  RejectRecoveryDto,
} from './dto/admin-recovery.dto';

/**
 * Account recovery, staff side (api-endpoints-plan §1.10). Two people are needed: one opens with
 * the evidence, another approves — and `ADMIN` does not hold the approving permission, so that is
 * a `SUPER_ADMIN`. identity refuses the opener approving their own case, and the database agrees.
 */
@ApiTags('admin-recoveries')
@UsesUpstream()
@Controller('admin')
export class AdminRecoveriesController {
  constructor(private readonly recoveries: AdminRecoveriesService) {}

  @Post('users/:id/email-recoveries')
  @RequirePermission('user.email.recover.open')
  @NoStore()
  @ApiOperation({ summary: 'Open a recovery for a verified owner, with what support checked.' })
  @ApiEnvelope(RecoveryResultResponseDto, { status: HttpStatus.CREATED })
  @ApiErrors('RECOVERY_EVIDENCE_INSUFFICIENT', 'INVALID_STATE', 'RESOURCE_NOT_FOUND')
  @ZodSerializerDto(RecoveryResultResponseDto)
  openRecovery(
    @Ctx() context: AccountContext,
    @Param() params: RecoverySubjectParamDto,
    @Body() body: OpenRecoveryDto,
  ): Promise<{ recovery: Recovery }> {
    return this.recoveries.open(context, params.id, body);
  }

  @Get('email-recoveries')
  @RequirePermission('user.email.recover.open')
  @NoStore()
  @ApiOperation({ summary: 'The cases, a page at a time; newest first.' })
  @ApiEnvelope(RecoveryResponseDto, { list: 'page' })
  @ZodSerializerDto(RecoveryResponseDto)
  list(@Ctx() context: AccountContext, @Query() query: RecoveryQueryDto): Promise<Paged<Recovery>> {
    return this.recoveries.list(context, query);
  }

  @Post('email-recoveries/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('user.email.recover.approve')
  @NoStore()
  @ApiOperation({
    summary: 'Start the hold: the owner is told, and has three days to stop it.',
  })
  @ApiEnvelope(RecoveryResultResponseDto)
  @ApiErrors('RECOVERY_SELF_APPROVAL', 'INVALID_STATE', 'RESOURCE_NOT_FOUND')
  @ZodSerializerDto(RecoveryResultResponseDto)
  approve(
    @Ctx() context: AccountContext,
    @Param() params: RecoveryIdParamDto,
  ): Promise<{ recovery: Recovery }> {
    return this.recoveries.approve(context, params.id);
  }

  @Post('email-recoveries/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('user.email.recover.approve')
  @NoStore()
  @ApiOperation({ summary: 'End the case with a note; the owner is told it is over.' })
  @ApiEnvelope(RecoveryResultResponseDto)
  @ApiErrors('INVALID_STATE', 'RESOURCE_NOT_FOUND')
  @ZodSerializerDto(RecoveryResultResponseDto)
  reject(
    @Ctx() context: AccountContext,
    @Param() params: RecoveryIdParamDto,
    @Body() body: RejectRecoveryDto,
  ): Promise<{ recovery: Recovery }> {
    return this.recoveries.reject(context, params.id, body);
  }
}
