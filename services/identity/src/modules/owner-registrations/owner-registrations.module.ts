import { Module } from '@nestjs/common';
import { OwnerRegistrationsGrpcController } from './owner-registrations-grpc.controller';
import { OwnerRegistrationsService } from './owner-registrations.service';

/** An applicant's owner applications (api-endpoints-plan §1.4, rdm-spec I-8). */
@Module({
  controllers: [OwnerRegistrationsGrpcController],
  providers: [OwnerRegistrationsService],
  exports: [OwnerRegistrationsService],
})
export class OwnerRegistrationsModule {}
