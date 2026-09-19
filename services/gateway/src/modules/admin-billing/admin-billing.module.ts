import { Module } from '@nestjs/common';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from './admin-billing.service';

/** `/admin/billing`, backed by billing's account and event admin services. */
@Module({ controllers: [AdminBillingController], providers: [AdminBillingService] })
export class AdminBillingModule {}
