import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/** `/users/me` routes, backed by `identity.UserService`. */
@Module({
  imports: [IdentityModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
