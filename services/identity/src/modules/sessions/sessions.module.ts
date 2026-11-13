import { Global, Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';

/** Session lineages (rdm-spec I-3): opening, rotating and revoking. */
@Global()
@Module({
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
