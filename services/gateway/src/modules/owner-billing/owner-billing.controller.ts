import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { BillingOverview, Invoice, Plan } from '@wayfare/contracts';
import {
  ApiEnvelope,
  ApiErrors,
  Auth,
  Ctx,
  Idempotent,
  NoStore,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  BillingOverviewResponseDto,
  InvoiceResponseDto,
  PlanResponseDto,
  SessionUrlResponseDto,
} from './dto/owner-billing-response.dto';
import { CheckoutSessionDto } from './dto/owner-billing.dto';
import { OwnerBillingService } from './owner-billing.service';

/**
 * `/owner/billing` — the owner subscription (api-endpoints-plan §5.1). Everything reads billing's
 * Postgres except the invoice list; Checkout and the portal are Stripe-hosted pages.
 */
@ApiTags('owner-billing')
@UsesUpstream()
@Controller('owner/billing')
export class OwnerBillingController {
  constructor(private readonly billing: OwnerBillingService) {}

  @Get()
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'Plan, status, dunning, grants and usage — never a Stripe call.' })
  @ApiEnvelope(BillingOverviewResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(BillingOverviewResponseDto)
  overview(@Ctx() context: AccountContext): Promise<BillingOverview> {
    return this.billing.overview(context);
  }

  @Get('plans')
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'Plans an owner can move to: active and priced, never FREE.' })
  @ApiEnvelope(PlanResponseDto, { array: true })
  @ZodSerializerDto([PlanResponseDto])
  plans(@Ctx() context: AccountContext): Promise<Plan[]> {
    return this.billing.plans(context);
  }

  @Post('checkout-session')
  @HttpCode(HttpStatus.OK)
  @Auth('OWNER')
  @Idempotent()
  @NoStore()
  @ApiOperation({
    summary: 'A Stripe Checkout for a plan price. Entitlements follow from the webhook.',
  })
  @ApiEnvelope(SessionUrlResponseDto)
  @ApiErrors(
    'SUBSCRIPTION_EXISTS',
    'LEGAL_VERSION_OUTDATED',
    'RESOURCE_NOT_FOUND',
    'IDEMPOTENCY_KEY_REQUIRED',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_KEY_IN_FLIGHT',
  )
  @ZodSerializerDto(SessionUrlResponseDto)
  checkout(
    @Ctx() context: AccountContext,
    @Body() body: CheckoutSessionDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<{ url: string }> {
    return this.billing.checkout(context, body, idempotencyKey);
  }

  @Post('portal-session')
  @HttpCode(HttpStatus.OK)
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'The Stripe Customer Portal: plan changes, cancellation, the card.' })
  @ApiEnvelope(SessionUrlResponseDto)
  @ApiErrors('NO_STRIPE_CUSTOMER')
  @ZodSerializerDto(SessionUrlResponseDto)
  portal(@Ctx() context: AccountContext): Promise<{ url: string }> {
    return this.billing.portal(context);
  }

  @Get('invoices')
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: "Stripe's invoices, cached five minutes; none before a checkout." })
  @ApiEnvelope(InvoiceResponseDto, { array: true })
  @ZodSerializerDto([InvoiceResponseDto])
  invoices(@Ctx() context: AccountContext): Promise<Invoice[]> {
    return this.billing.invoices(context);
  }
}
