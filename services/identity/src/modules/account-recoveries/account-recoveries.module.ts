import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccountRecoveriesGrpcController } from './account-recoveries-grpc.controller';
import { AccountRecoveriesService } from './account-recoveries.service';

/** The owner's side of account recovery (api-endpoints-plan §1.10). */
@Module({
  imports: [NotificationsModule],
  controllers: [AccountRecoveriesGrpcController],
  providers: [AccountRecoveriesService],
  exports: [AccountRecoveriesService],
})
export class AccountRecoveriesModule {}
