import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AccountRecoveriesController } from './account-recoveries.controller';
import { AccountRecoveriesService } from './account-recoveries.service';

/** The owner's own recovery routes (api-endpoints-plan §1.10). */
@Module({
  imports: [IdentityModule],
  controllers: [AccountRecoveriesController],
  providers: [AccountRecoveriesService],
})
export class AccountRecoveriesModule {}
