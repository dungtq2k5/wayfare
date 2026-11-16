import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { EmailWebhooksController } from './email-webhooks.controller';
import { EmailWebhooksService } from './email-webhooks.service';

/** The Resend delivery webhook, forwarded to `identity.EmailWebhookService`. */
@Module({
  imports: [IdentityModule],
  controllers: [EmailWebhooksController],
  providers: [EmailWebhooksService],
})
export class EmailWebhooksModule {}
