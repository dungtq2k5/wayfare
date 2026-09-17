import { Module } from '@nestjs/common';
import { BillingPortService } from './billing-port.service';

/** identity's port to billing (api-endpoints-plan §12.2). */
@Module({
  providers: [BillingPortService],
  exports: [BillingPortService],
})
export class BillingPortModule {}
