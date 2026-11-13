import { Module } from '@nestjs/common';
import { BillingEventsGrpcController } from './billing-events-grpc.controller';
import { BillingEventsService } from './billing-events.service';

/** Recorded Stripe events, for staff (api-endpoints-plan §6.2). */
@Module({ controllers: [BillingEventsGrpcController], providers: [BillingEventsService] })
export class BillingEventsModule {}
