import { Module } from '@nestjs/common';
import { AccountSecurityGrpcController } from './account-security-grpc.controller';
import { AccountSecurityService } from './account-security.service';

/** What billing reads before a payout change (api-endpoints-plan §12.2, ADR 0052). */
@Module({
  controllers: [AccountSecurityGrpcController],
  providers: [AccountSecurityService],
  exports: [AccountSecurityService],
})
export class AccountSecurityModule {}
