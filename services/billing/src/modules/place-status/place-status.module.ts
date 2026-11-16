import { Module } from '@nestjs/common';
import { PlaceStatusConsumer } from './place-status.consumer';

/** The `catalog.place.status_changed` consumer: a Venue's boost ends when it stops being live. */
@Module({ providers: [PlaceStatusConsumer], exports: [PlaceStatusConsumer] })
export class PlaceStatusModule {}
