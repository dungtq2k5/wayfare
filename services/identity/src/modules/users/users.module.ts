import { Module } from '@nestjs/common';
import { UsersGrpcController } from './users-grpc.controller';
import { UsersService } from './users.service';

/** The caller's own account (api-endpoints-plan §1.3). */
@Module({
  controllers: [UsersGrpcController],
  providers: [UsersService],
})
export class UsersModule {}
