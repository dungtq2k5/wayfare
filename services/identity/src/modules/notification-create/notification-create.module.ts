import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationCreateConsumer } from './notification-create.consumer';

/** The `notification.create` consumer. */
@Module({
  imports: [NotificationsModule],
  providers: [NotificationCreateConsumer],
  exports: [NotificationCreateConsumer],
})
export class NotificationCreateModule {}
