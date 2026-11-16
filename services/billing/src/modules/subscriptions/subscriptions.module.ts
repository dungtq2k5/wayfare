import { Module } from '@nestjs/common';
import { SubscriptionsGrpcController } from './subscriptions-grpc.controller';
import { SubscriptionsService } from './subscriptions.service';

/** The owner subscription routes (api-endpoints-plan §5.1). */
@Module({ controllers: [SubscriptionsGrpcController], providers: [SubscriptionsService] })
export class SubscriptionsModule {}
