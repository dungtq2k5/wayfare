import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OwnerRegistrationController } from './owner-registration.controller';
import { OwnerRegistrationService } from './owner-registration.service';

/** `/owner/registration`, backed by `identity.OwnerService`. */
@Module({
  imports: [IdentityModule],
  controllers: [OwnerRegistrationController],
  providers: [OwnerRegistrationService],
})
export class OwnerRegistrationModule {}
