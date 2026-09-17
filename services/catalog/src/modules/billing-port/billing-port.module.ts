import { Module } from '@nestjs/common';
import { BillingPortService } from './billing-port.service';

/** catalog's port to billing (api-endpoints-plan §12.2). */
@Module({
  providers: [BillingPortService],
  exports: [BillingPortService],
})
export class BillingPortModule {}
