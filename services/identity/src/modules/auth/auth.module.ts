import { Module } from '@nestjs/common';
import { AuthGrpcController } from './auth-grpc.controller';
import { AuthService } from './auth.service';

/** Sign-in, refresh rotation and sign-out (api-endpoints-plan §1.2). */
@Module({
  controllers: [AuthGrpcController],
  providers: [AuthService],
})
export class AuthModule {}
