import { Global, Module } from '@nestjs/common';
import { LegalService } from './legal.service';

/** Legal acceptances (rdm-spec I-12), recorded for devices and accounts. */
@Global()
@Module({
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
