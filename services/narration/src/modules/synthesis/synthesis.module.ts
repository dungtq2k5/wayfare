import { Global, Module } from '@nestjs/common';
import { ProvidersHealthModule } from '../providers-health/providers-health.module';
import { SynthesisService } from './synthesis.service';

/** The shared localize-and-voice steps (rdm-spec N-3, N-4): the pipeline's and the stream's. */
@Global()
@Module({
  imports: [ProvidersHealthModule],
  providers: [SynthesisService],
  exports: [SynthesisService],
})
export class SynthesisModule {}
