import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  ApiEnvelope,
  Auth,
  Ctx,
  RateLimit,
  SkipClientHeader,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import type { Request } from 'express';
import { StripeWebhooksService } from './stripe-webhooks.service';

/**
 * `POST /api/webhooks/stripe` — Stripe's platform events, version-neutral so the URL registered
 * with Stripe never moves (api-endpoints-plan §6.3). No client header, no rate limit, no auth guard:
 * nothing may refuse Stripe before billing checks its signature over the exact bytes.
 */
@ApiExcludeController()
@UsesUpstream()
@SkipClientHeader()
@Controller({ path: 'webhooks/stripe', version: VERSION_NEUTRAL })
export class StripeWebhooksController {
  constructor(private readonly webhooks: StripeWebhooksService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('SIGNATURE')
  @RateLimit(null)
  @ApiEnvelope(null)
  async receive(
    @Ctx() context: RequestContext,
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<void> {
    await this.webhooks.forward(context, request.rawBody ?? Buffer.alloc(0), signature ?? '');
  }
}
