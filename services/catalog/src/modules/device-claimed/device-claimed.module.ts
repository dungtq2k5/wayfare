import { Module } from '@nestjs/common';
import { FavoritesModule } from '../favorites/favorites.module';
import { DeviceClaimedConsumer } from './device-claimed.consumer';

/** The `identity.device.claimed` consumer. */
@Module({
  imports: [FavoritesModule],
  providers: [DeviceClaimedConsumer],
  exports: [DeviceClaimedConsumer],
})
export class DeviceClaimedModule {}
