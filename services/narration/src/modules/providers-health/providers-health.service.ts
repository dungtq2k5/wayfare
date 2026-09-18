import { Inject, Injectable, Logger } from '@nestjs/common';
import { SUPPORTED_LANGUAGES } from '@wayfare/contracts';
import type { ProviderHealth, VoiceCatalogue } from '@wayfare/contracts';
import type { Redis } from 'ioredis';
import { voiceFor } from '../../config/voices';
import { PROVIDER_CHAINS } from '../../providers/configured-providers';
import type { ProviderChains } from '../../providers/configured-providers';
import type { ProviderChain } from '../../providers/provider-chain';
import type { VoiceSpec } from '../../providers/speech/speech-provider';
import { REDIS } from '../redis/redis.module';

/** How long a provider's voice catalogue is cached (api-endpoints-plan §4.3). */
export const VOICE_CATALOGUE_TTL_S = 6 * 60 * 60;

/**
 * The providers as this process sees them: each chain's breakers for the monitor, and each speech
 * provider's catalogue beside the pinned voices (api-endpoints-plan §4.3). Breakers are per process.
 */
@Injectable()
export class ProvidersHealthService {
  private readonly logger = new Logger(ProvidersHealthService.name);

  constructor(
    @Inject(PROVIDER_CHAINS) readonly chains: ProviderChains,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Every configured provider's breaker, translation first. */
  providers(): ProviderHealth[] {
    const report = (
      role: ProviderHealth['role'],
      chain: ProviderChain<{ readonly name: string }>,
    ) =>
      chain.states().map((state): ProviderHealth => ({
        name: state.name,
        role,
        position: state.position,
        breaker: state.breaker,
        consecutiveFailures: state.consecutiveFailures,
        errorRate: state.errorRate,
        recentCalls: state.recentCalls,
        coolingUntil: state.coolingUntil?.toISOString() ?? null,
        scope: 'process',
      }));
    return [
      ...report('translation', this.chains.translation),
      ...report('speech', this.chains.speech),
    ];
  }

  /** For each speech provider and each language it has a pinned voice for: the pin and the catalogue. */
  async voices(): Promise<VoiceCatalogue[]> {
    const catalogues: VoiceCatalogue[] = [];
    for (const provider of this.chains.speech.providers) {
      for (const lang of SUPPORTED_LANGUAGES) {
        const pinned = voiceFor(provider.name, lang);
        if (pinned === null) continue;
        const available = await this.catalogue(provider.name, pinned.languageCode, () =>
          provider.listVoices(pinned.languageCode),
        );
        catalogues.push({
          lang,
          provider: provider.name,
          pinnedVoiceId: pinned.id,
          available: available.map((voice) => ({
            id: voice.id,
            languageCode: voice.languageCode,
            gender: voice.gender ?? null,
          })),
        });
      }
    }
    return catalogues;
  }

  /** A catalogue from the cache, else from the provider; a provider that cannot answer lists none. */
  private async catalogue(
    provider: string,
    languageCode: string,
    load: () => Promise<VoiceSpec[]>,
  ): Promise<VoiceSpec[]> {
    const key = `narration:voices:${provider}:${languageCode}`;
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) return JSON.parse(cached) as VoiceSpec[];
    } catch {
      // The cache is only a shortcut.
    }
    try {
      const voices = await load();
      await this.redis
        .set(key, JSON.stringify(voices), 'EX', VOICE_CATALOGUE_TTL_S)
        .catch(() => undefined);
      return voices;
    } catch (error) {
      this.logger.warn(
        { provider, languageCode, err: error instanceof Error ? error.message : 'unknown' },
        'voice catalogue unavailable',
      );
      return [];
    }
  }
}
