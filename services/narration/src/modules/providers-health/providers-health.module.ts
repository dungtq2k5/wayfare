import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NarrationConfig } from '../../config/env.schema';
import { configuredChains, PROVIDER_CHAINS } from '../../providers/configured-providers';
import { ProvidersHealthService } from './providers-health.service';

/** The provider chains, built once per process from configuration, and their health. */
@Module({
  providers: [
    {
      provide: PROVIDER_CHAINS,
      inject: [ConfigService],
      useFactory: (config: NarrationConfig) =>
        configuredChains({
          TRANSLATION_PROVIDER_ORDER: config.get('TRANSLATION_PROVIDER_ORDER', { infer: true }),
          TTS_PROVIDER_ORDER: config.get('TTS_PROVIDER_ORDER', { infer: true }),
          GOOGLE_CLOUD_PROJECT: config.get('GOOGLE_CLOUD_PROJECT', { infer: true }),
          FAKE_PROVIDER_FAILURES: config.get('FAKE_PROVIDER_FAILURES', { infer: true }),
        }),
    },
    ProvidersHealthService,
  ],
  exports: [ProvidersHealthService],
})
export class ProvidersHealthModule {}
