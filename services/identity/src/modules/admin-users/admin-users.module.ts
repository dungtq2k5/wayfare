import { Module } from '@nestjs/common';
import { BillingPortModule } from '../billing-port/billing-port.module';
import { AdminUsersGrpcController } from './admin-users-grpc.controller';
import { AdminUsersService } from './admin-users.service';

/** Staff administration of accounts (api-endpoints-plan §1.6). */
@Module({
  imports: [BillingPortModule],
  controllers: [AdminUsersGrpcController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
