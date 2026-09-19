import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OwnerBillingController } from './owner-billing.controller';
import { OwnerBillingService } from './owner-billing.service';

/** `/owner/billing`, backed by `billing.BillingService`. */
@Module({
  imports: [IdentityModule],
  controllers: [OwnerBillingController],
  providers: [OwnerBillingService],
})
export class OwnerBillingModule {}
