import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { EmailWebhooksService } from './email-webhooks.service';

/** `wayfare.identity.EmailWebhookService` — the gateway forwards; identity verifies and applies. */
@Controller()
@identityGrpc.EmailWebhookServiceControllerMethods()
export class EmailWebhooksGrpcController implements identityGrpc.EmailWebhookServiceController {
  constructor(private readonly webhooks: EmailWebhooksService) {}

  receiveResendEvent(
    request: identityGrpc.ReceiveResendEventRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ReceiveResendEventResponse> {
    unpackCallerContext(metadata);
    return this.webhooks.receiveResendEvent(request);
  }
}
