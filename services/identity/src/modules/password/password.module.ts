import { Module } from '@nestjs/common';
import { PasswordGrpcController } from './password-grpc.controller';
import { PasswordService } from './password.service';

/** Password reset, account setup and password change (api-endpoints-plan §1.2). */
@Module({
  controllers: [PasswordGrpcController],
  providers: [PasswordService],
})
export class PasswordModule {}
