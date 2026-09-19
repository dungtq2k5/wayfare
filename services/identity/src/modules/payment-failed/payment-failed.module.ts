import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentFailedConsumer } from './payment-failed.consumer';

/** The `billing.subscription.payment_failed` consumer. */
@Module({
  imports: [NotificationsModule],
  providers: [PaymentFailedConsumer],
  exports: [PaymentFailedConsumer],
})
export class PaymentFailedModule {}
