import { Module } from '@nestjs/common';
import { PlacesModule } from '../places/places.module';
import { EntitlementsChangedConsumer } from './entitlements-changed.consumer';

/** The `billing.entitlements.changed` consumer. */
@Module({
  imports: [PlacesModule],
  providers: [EntitlementsChangedConsumer],
  exports: [EntitlementsChangedConsumer],
})
export class EntitlementsChangedModule {}
