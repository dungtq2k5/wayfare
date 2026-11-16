import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminRecoveriesGrpcController } from './admin-recoveries-grpc.controller';
import { AdminRecoveriesService } from './admin-recoveries.service';

/** The staff side of account recovery (api-endpoints-plan §1.10, rdm-spec I-14). */
@Module({
  imports: [NotificationsModule],
  controllers: [AdminRecoveriesGrpcController],
  providers: [AdminRecoveriesService],
  exports: [AdminRecoveriesService],
})
export class AdminRecoveriesModule {}
