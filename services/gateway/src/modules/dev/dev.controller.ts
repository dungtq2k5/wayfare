import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Auth, Ctx, NoStore, RateLimit, UsesUpstream } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { DevService } from './dev.service';
import { FakeGoogleTokenDto } from './dto/dev.dto';
import { FakeCheckoutPaidResponseDto } from './dto/fake-checkout-paid-response.dto';
import { FakeGoogleTokenResponseDto } from './dto/fake-google-token-response.dto';

/**
 * `/dev` — the fake Google issuer's token (`GOOGLE_ISSUER=fake`, ADR 0063) and the fake Checkout's
 * payment (`PAYMENTS_PROVIDER=fake`): each answers only on a stack running that fake, which
 * production refuses, and is kept out of the published API document.
 */
@ApiExcludeController()
@UsesUpstream()
@Controller('dev')
export class DevController {
  constructor(private readonly dev: DevService) {}

  @Post('google-token')
  @HttpCode(HttpStatus.OK)
  @Auth('PUBLIC')
  @RateLimit('PUBLIC_READ')
  @NoStore()
  @ZodSerializerDto(FakeGoogleTokenResponseDto)
  fakeGoogleToken(
    @Ctx() context: RequestContext,
    @Body() body: FakeGoogleTokenDto,
  ): Promise<{ idToken: string }> {
    return this.dev.fakeGoogleToken(context, body);
  }

  /** The console's fake Checkout page paying its session: billing applies what Stripe would send. */
  @Post('fake-stripe/checkout/:sessionId/pay')
  @HttpCode(HttpStatus.OK)
  @Auth('PUBLIC')
  @RateLimit('PUBLIC_READ')
  @NoStore()
  @ZodSerializerDto(FakeCheckoutPaidResponseDto)
  payFakeCheckout(
    @Ctx() context: RequestContext,
    @Param('sessionId') sessionId: string,
  ): Promise<{ successUrl: string }> {
    return this.dev.payFakeCheckout(context, sessionId);
  }
}
