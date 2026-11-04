import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BoostEndedConsumer } from './boost-ended.consumer';

/** The `billing.boost.ended` consumer: a Venue's lost boost, in its owner's bell. */
@Module({
  imports: [NotificationsModule],
  providers: [BoostEndedConsumer],
  exports: [BoostEndedConsumer],
})
export class BoostEndedModule {}
