import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PeopleNamesModule } from '../people-names/people-names.module';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from './admin-billing.service';

/** `/admin/billing`, backed by billing's account and event admin services. */
@Module({
  imports: [PeopleNamesModule, CatalogModule],
  controllers: [AdminBillingController],
  providers: [AdminBillingService],
})
export class AdminBillingModule {}
