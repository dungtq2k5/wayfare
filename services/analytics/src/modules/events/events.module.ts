import { Module } from '@nestjs/common';
import { EventsGrpcController } from './events-grpc.controller';
import { EventsService } from './events.service';

/** Consent (A-1), ingest (A-2) and the heatmap's counters — the tourist's writes. */
@Module({ controllers: [EventsGrpcController], providers: [EventsService] })
export class EventsModule {}
