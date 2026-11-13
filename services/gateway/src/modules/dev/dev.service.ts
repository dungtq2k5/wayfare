import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppHttpException } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import type { Env } from '../../config/env.schema';
import { BillingServiceGrpcClient } from '../billing/billing-service-grpc.client';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import type { FakeGoogleTokenDto } from './dto/dev.dto';

/**
 * Development only: identity's fake Google issuer, for the tests and the app's Diagnostics; and
 * billing's fake Checkout, for the console's dev page.
 */
@Injectable()
export class DevService {
  private readonly fake: boolean;

  constructor(
    private readonly identity: IdentityServiceGrpcClient,
    private readonly billing: BillingServiceGrpcClient,
    config: ConfigService<Env, true>,
  ) {
    this.fake = config.get('GOOGLE_ISSUER', { infer: true }) === 'fake';
  }

  /** Not there unless the stack runs the fake issuer (ADR 0063): `404`, as any unknown route. */
  async fakeGoogleToken(
    context: RequestContext,
    body: FakeGoogleTokenDto,
  ): Promise<{ idToken: string }> {
    if (!this.fake) throw new AppHttpException('RESOURCE_NOT_FOUND', { resource: 'ROUTE' });
    return this.identity.auth.call(
      'mintFakeGoogleToken',
      {
        email: body.email,
        emailVerified: body.emailVerified,
        nonce: body.nonce,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.sub === undefined ? {} : { sub: body.sub }),
        ...(body.hd === undefined ? {} : { hd: body.hd }),
      },
      context,
    );
  }

  /** Billing refuses it (`404`) unless it runs the fake provider outside production. */
  payFakeCheckout(context: RequestContext, sessionId: string): Promise<{ successUrl: string }> {
    return this.billing.webhooks.call('payFakeCheckout', { sessionId }, context);
  }
}
