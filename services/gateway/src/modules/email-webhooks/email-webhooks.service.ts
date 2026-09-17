import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';

/** The signed parts of a Resend delivery event, exactly as received. */
export interface ResendDelivery {
  readonly rawBody: Buffer;
  readonly svixId: string;
  readonly svixTimestamp: string;
  readonly svixSignature: string;
}

/**
 * Forwards Resend's delivery events to identity, which holds the secret, verifies and applies
 * them (api-endpoints-plan §1.9). The gateway reads nothing in the body — it names the recipient.
 */
@Injectable()
export class EmailWebhooksService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async forward(context: RequestContext, delivery: ResendDelivery): Promise<void> {
    await this.identity.emailWebhooks.call('receiveResendEvent', { ...delivery }, context);
  }
}
