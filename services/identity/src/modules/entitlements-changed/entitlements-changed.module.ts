import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { EntitlementsChangedConsumer } from './entitlements-changed.consumer';

/** The `billing.entitlements.changed` consumer. */
@Module({
  imports: [NotificationsModule],
  providers: [EntitlementsChangedConsumer],
  exports: [EntitlementsChangedConsumer],
})
export class EntitlementsChangedModule {}
