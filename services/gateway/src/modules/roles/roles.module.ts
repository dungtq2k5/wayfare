import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/** `/admin/roles` and `/admin/permissions`, backed by `identity.RoleService`. */
@Module({
  imports: [IdentityModule],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
