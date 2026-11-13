import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { PasswordController } from './password.controller';
import { PasswordService } from './password.service';

/** `/auth/password` routes, backed by `identity.PasswordService`. */
@Module({
  imports: [IdentityModule, AuthModule],
  controllers: [PasswordController],
  providers: [PasswordService],
})
export class PasswordModule {}
