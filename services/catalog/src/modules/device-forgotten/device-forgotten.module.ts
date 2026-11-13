import { Module } from '@nestjs/common';
import { FavoritesModule } from '../favorites/favorites.module';
import { DeviceForgottenConsumer } from './device-forgotten.consumer';

/** The `identity.device.forgotten` consumer. */
@Module({
  imports: [FavoritesModule],
  providers: [DeviceForgottenConsumer],
  exports: [DeviceForgottenConsumer],
})
export class DeviceForgottenModule {}
