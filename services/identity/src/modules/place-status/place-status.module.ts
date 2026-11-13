import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlaceStatusConsumer } from './place-status.consumer';

/** The `catalog.place.status_changed` consumer. */
@Module({
  imports: [NotificationsModule],
  providers: [PlaceStatusConsumer],
  exports: [PlaceStatusConsumer],
})
export class PlaceStatusModule {}
