import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { BillingAccountDetail, BillingAccountSummary, BillingEvent } from '@wayfare/contracts';
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
import { AdminBillingService } from './admin-billing.service';
import {
  BillingAccountDetailResponseDto,
  BillingAccountResultResponseDto,
  BillingAccountSummaryResponseDto,
  BillingEventResponseDto,
  BillingEventResultResponseDto,
} from './dto/admin-billing-response.dto';
import {
  BillingAccountsQueryDto,
  BillingEventsQueryDto,
  BillingIdParamDto,
  OverrideEntitlementsDto,
  UnpinDto,
} from './dto/admin-billing.dto';

/**
 * `/admin/billing` — accounts, pinned grants and Stripe's recorded events (api-endpoints-plan §6.2).
 * An override pins in the same write, so a renewal webhook cannot revert it.
 */
@ApiTags('admin-billing')
@UsesUpstream()
@Controller('admin/billing')
export class AdminBillingController {
  constructor(private readonly billing: AdminBillingService) {}

  @Get('accounts')
  @RequirePermission('billing.account.read')
  @NoStore()
  @ApiOperation({ summary: 'Billing accounts, by plan, status, pin and dunning; page style.' })
  @ApiEnvelope(BillingAccountSummaryResponseDto, { list: 'page' })
  @ZodSerializerDto(BillingAccountSummaryResponseDto)
  accounts(
    @Ctx() context: AccountContext,
    @Query() query: BillingAccountsQueryDto,
  ): Promise<Paged<BillingAccountSummary>> {
    return this.billing.accounts(context, query);
  }

  @Get('accounts/:id')
  @RequirePermission('billing.account.read')
  @NoStore()
  @ApiOperation({ summary: "An account: effective grants beside its plan's, recent events." })
  @ApiEnvelope(BillingAccountDetailResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(BillingAccountDetailResponseDto)
  account(
    @Ctx() context: AccountContext,
    @Param() params: BillingIdParamDto,
  ): Promise<BillingAccountDetail> {
    return this.billing.account(context, params.id);
  }

  @Patch('accounts/:id/entitlements')
  @RequirePermission('billing.entitlement.override')
  @NoStore()
  @ApiOperation({ summary: 'An off-catalogue grant, pinned in the same write.' })
  @ApiEnvelope(BillingAccountResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(BillingAccountResultResponseDto)
  override(
    @Ctx() context: AccountContext,
    @Param() params: BillingIdParamDto,
    @Body() body: OverrideEntitlementsDto,
  ): Promise<{ account: BillingAccountDetail }> {
    return this.billing.override(context, params.id, body);
  }

  @Post('accounts/:id/unpin')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('billing.entitlement.override')
  @NoStore()
  @ApiOperation({ summary: 'Clear the pin and re-derive the grants from the plan now.' })
  @ApiEnvelope(BillingAccountResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(BillingAccountResultResponseDto)
  unpin(
    @Ctx() context: AccountContext,
    @Param() params: BillingIdParamDto,
    @Body() body: UnpinDto,
  ): Promise<{ account: BillingAccountDetail }> {
    return this.billing.unpin(context, params.id, body);
  }

  @Get('events')
  @RequirePermission('billing.event.read')
  @NoStore()
  @ApiOperation({ summary: "Stripe's recorded events, payloads included; page style." })
  @ApiEnvelope(BillingEventResponseDto, { list: 'page' })
  @ZodSerializerDto(BillingEventResponseDto)
  events(
    @Ctx() context: AccountContext,
    @Query() query: BillingEventsQueryDto,
  ): Promise<Paged<BillingEvent>> {
    return this.billing.events(context, query);
  }

  @Post('events/:id/replay')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('billing.event.read')
  @NoStore()
  @ApiOperation({ summary: 'Re-run a FAILED event with the same guards: a stale one still skips.' })
  @ApiEnvelope(BillingEventResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'INVALID_STATE')
  @ZodSerializerDto(BillingEventResultResponseDto)
  replay(
    @Ctx() context: AccountContext,
    @Param() params: BillingIdParamDto,
  ): Promise<{ event: BillingEvent }> {
    return this.billing.replay(context, params.id);
  }
}
