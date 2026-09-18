import { Module } from '@nestjs/common';
import { OwnerRegistrationsModule } from '../owner-registrations/owner-registrations.module';
import { UsersGrpcController } from './users-grpc.controller';
import { UsersService } from './users.service';

/** The caller's own account (api-endpoints-plan §1.3). */
@Module({
  imports: [OwnerRegistrationsModule],
  controllers: [UsersGrpcController],
  providers: [UsersService],
})
export class UsersModule {}
