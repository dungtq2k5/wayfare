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
import { EmailWebhooksService } from './email-webhooks.service';

/**
 * `POST /api/webhooks/resend` — version-neutral, so the URL registered with Resend never moves
 * (api-endpoints-plan §0.10, §1.9). No client header and no rate limit: nothing may refuse the
 * provider before identity checks its signature.
 */
@ApiExcludeController()
@UsesUpstream()
@SkipClientHeader()
@Controller({ path: 'webhooks/resend', version: VERSION_NEUTRAL })
export class EmailWebhooksController {
  constructor(private readonly webhooks: EmailWebhooksService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('SIGNATURE')
  @RateLimit(null)
  @ApiEnvelope(null)
  async receive(
    @Ctx() context: RequestContext,
    @Req() request: RawBodyRequest<Request>,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
  ): Promise<void> {
    await this.webhooks.forward(context, {
      rawBody: request.rawBody ?? Buffer.alloc(0),
      svixId: svixId ?? '',
      svixTimestamp: svixTimestamp ?? '',
      svixSignature: svixSignature ?? '',
    });
  }
}
