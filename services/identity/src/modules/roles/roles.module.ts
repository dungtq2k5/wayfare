import { Module } from '@nestjs/common';
import { MAX_ROLE_HOLDERS_PER_CHANGE } from '@wayfare/contracts';
import { RolesGrpcController } from './roles-grpc.controller';
import { ROLE_HOLDERS_LIMIT, RolesService } from './roles.service';

/** Custom roles and the permission catalogue (api-endpoints-plan §1.6). */
@Module({
  controllers: [RolesGrpcController],
  providers: [RolesService, { provide: ROLE_HOLDERS_LIMIT, useValue: MAX_ROLE_HOLDERS_PER_CHANGE }],
})
export class RolesModule {}
