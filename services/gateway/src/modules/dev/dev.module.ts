import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DevController } from './dev.controller';
import { DevService } from './dev.service';

/** Development only: the fake Google issuer's route (ADR 0063). */
@Module({
  imports: [IdentityModule],
  controllers: [DevController],
  providers: [DevService],
})
export class DevModule {}
