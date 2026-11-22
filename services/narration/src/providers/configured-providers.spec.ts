import { describe, expect, it } from 'vitest';
import { configuredChains } from './configured-providers';

describe('the provider chains from configuration (conventions §11.5)', () => {
  it('builds each chain in the configured order, the real providers by name', () => {
    const chains = configuredChains({
      TRANSLATION_PROVIDER_ORDER: ['google', 'free', 'fake'],
      TTS_PROVIDER_ORDER: ['google', 'edge', 'fake'],
      GOOGLE_CLOUD_PROJECT: 'wayfare',
    });
    expect(chains.translation.providers.map((provider) => provider.name)).toEqual([
      'google',
      'free',
      'fake',
    ]);
    expect(chains.speech.providers.map((provider) => provider.name)).toEqual([
      'google',
      'edge',
      'fake',
    ]);
  });
});
