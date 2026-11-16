import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { EmailChangeController } from './email-change.controller';
import { EmailChangeService } from './email-change.service';

/** `/auth/email` routes, backed by `identity.EmailChangeService`. */
@Module({
  imports: [IdentityModule, AuthModule],
  controllers: [EmailChangeController],
  providers: [EmailChangeService],
})
export class EmailChangeModule {}
