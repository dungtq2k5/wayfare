import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AdminOwnerRegistrationsController } from './admin-owner-registrations.controller';
import { AdminOwnerRegistrationsService } from './admin-owner-registrations.service';

/** `/admin/owner-registrations`, backed by `identity.OwnerReviewService`. */
@Module({
  imports: [IdentityModule],
  controllers: [AdminOwnerRegistrationsController],
  providers: [AdminOwnerRegistrationsService],
})
export class AdminOwnerRegistrationsModule {}
