import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';

/** Roles and permissions as tokens and `GetMe` read them. */
@Global()
@Module({
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
