import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AdminRecoveriesController } from './admin-recoveries.controller';
import { AdminRecoveriesService } from './admin-recoveries.service';

/** Account recovery, staff side (api-endpoints-plan §1.10). */
@Module({
  imports: [IdentityModule],
  controllers: [AdminRecoveriesController],
  providers: [AdminRecoveriesService],
})
export class AdminRecoveriesModule {}
