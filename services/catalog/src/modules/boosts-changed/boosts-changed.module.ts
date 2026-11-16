import { Module } from '@nestjs/common';
import { BoostsChangedConsumer } from './boosts-changed.consumer';

/** The `billing.boosts.changed` consumer: a Place's boost weight, in its ranking column. */
@Module({ providers: [BoostsChangedConsumer], exports: [BoostsChangedConsumer] })
export class BoostsChangedModule {}
