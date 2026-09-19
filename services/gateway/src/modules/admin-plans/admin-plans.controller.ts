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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AdminPlan, ApplyResult } from '@wayfare/contracts';
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
import { AdminPlansService } from './admin-plans.service';
import {
  AdminPlanResponseDto,
  AdminPlanResultResponseDto,
  ApplyResultResponseDto,
} from './dto/admin-plan-response.dto';
import {
  ApplyPlanQueryDto,
  CreatePlanDto,
  PlanIdParamDto,
  RegisterPriceDto,
  UpdatePlanDto,
} from './dto/admin-plan.dto';

/**
 * `/admin/plans` — the plan catalogue (api-endpoints-plan §6.1). Editing a plan never touches its
 * subscribers; `apply` is the explicit fan-out, with a dry run.
 */
@ApiTags('admin-plans')
@UsesUpstream()
@Controller('admin/plans')
export class AdminPlansController {
  constructor(private readonly plans: AdminPlansService) {}

  @Get()
  @RequirePermission('billing.plan.manage')
  @NoStore()
  @ApiOperation({ summary: 'Every plan, with its prices and subscriber count.' })
  @ApiEnvelope(AdminPlanResponseDto, { array: true })
  @ZodSerializerDto([AdminPlanResponseDto])
  list(@Ctx() context: AccountContext): Promise<AdminPlan[]> {
    return this.plans.list(context);
  }

  @Post()
  @RequirePermission('billing.plan.manage')
  @NoStore()
  @ApiOperation({ summary: 'Create a plan; every grant is stated, each within its ceiling.' })
  @ApiEnvelope(AdminPlanResultResponseDto)
  @ZodSerializerDto(AdminPlanResultResponseDto)
  create(
    @Ctx() context: AccountContext,
    @Body() body: CreatePlanDto,
  ): Promise<{ plan: AdminPlan }> {
    return this.plans.create(context, body);
  }

  @Patch(':id')
  @RequirePermission('billing.plan.manage')
  @NoStore()
  @ApiOperation({ summary: 'Edit the catalogue row only; subscribers are untouched until apply.' })
  @ApiEnvelope(AdminPlanResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(AdminPlanResultResponseDto)
  update(
    @Ctx() context: AccountContext,
    @Param() params: PlanIdParamDto,
    @Body() body: UpdatePlanDto,
  ): Promise<{ plan: AdminPlan }> {
    return this.plans.update(context, params.id, body);
  }

  @Post(':id/prices')
  @RequirePermission('billing.plan.manage')
  @NoStore()
  @ApiOperation({
    summary: "Register a Stripe Price; its amount is read from Stripe. Replaces the interval's.",
  })
  @ApiEnvelope(AdminPlanResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'INVALID_STATE')
  @ZodSerializerDto(AdminPlanResultResponseDto)
  registerPrice(
    @Ctx() context: AccountContext,
    @Param() params: PlanIdParamDto,
    @Body() body: RegisterPriceDto,
  ): Promise<{ plan: AdminPlan }> {
    return this.plans.registerPrice(context, params.id, body);
  }

  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('billing.plan.manage')
  @NoStore()
  @ApiOperation({
    summary: "Write the plan's grants onto its unpinned subscribers; `dryRun` writes nothing.",
  })
  @ApiEnvelope(ApplyResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(ApplyResultResponseDto)
  apply(
    @Ctx() context: AccountContext,
    @Param() params: PlanIdParamDto,
    @Query() query: ApplyPlanQueryDto,
  ): Promise<ApplyResult> {
    return this.plans.apply(context, params.id, query.dryRun ?? false);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('billing.plan.manage')
  @NoStore()
  @ApiOperation({ summary: 'Retire a plan nobody is on. FREE is never retired.' })
  @ApiEnvelope(null)
  @ApiErrors('PLAN_HAS_SUBSCRIBERS', 'RESOURCE_NOT_FOUND', 'INVALID_STATE')
  async retire(@Ctx() context: AccountContext, @Param() params: PlanIdParamDto): Promise<void> {
    await this.plans.retire(context, params.id);
  }
}
