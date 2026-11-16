import { Module } from '@nestjs/common';
import { PlansGrpcController } from './plans-grpc.controller';
import { PlansService } from './plans.service';

/** The plan catalogue (api-endpoints-plan §6.1). */
@Module({ controllers: [PlansGrpcController], providers: [PlansService], exports: [PlansService] })
export class PlansModule {}
