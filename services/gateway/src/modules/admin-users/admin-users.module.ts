import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

/** `/admin/users` routes, backed by `identity.AdminUserService`. */
@Module({
  imports: [IdentityModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
