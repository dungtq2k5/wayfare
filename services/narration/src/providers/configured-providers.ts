import type { Env } from '../config/env.schema';
import { ProviderChain } from './provider-chain';
import { EdgeSpeechProvider } from './speech/edge.speech-provider';
import { FakeSpeechProvider } from './speech/fake.speech-provider';
import { GoogleSpeechProvider } from './speech/google.speech-provider';
import type { SpeechProvider } from './speech/speech-provider';
import { FakeTranslationProvider } from './translation/fake.translation-provider';
import { FreeTranslationProvider } from './translation/free.translation-provider';
import { GoogleTranslationProvider } from './translation/google.translation-provider';
import type { TranslationProvider } from './translation/translation-provider';

/** Injection token for the process's two provider chains. */
export const PROVIDER_CHAINS = Symbol('PROVIDER_CHAINS');

/** The configured providers of each role, in order, with their breakers (conventions §11.5). */
export interface ProviderChains {
  readonly translation: ProviderChain<TranslationProvider>;
  readonly speech: ProviderChain<SpeechProvider>;
}

/**
 * Builds each chain from the order variables: a fallback is configuration, not an `if`. The
 * schema has already checked that a named provider has what it needs.
 */
export function configuredChains(
  env: Pick<
    Env,
    | 'TRANSLATION_PROVIDER_ORDER'
    | 'TTS_PROVIDER_ORDER'
    | 'GOOGLE_CLOUD_PROJECT'
    | 'FAKE_PROVIDER_FAILURES'
  >,
): ProviderChains {
  const failing = new Set(env.FAKE_PROVIDER_FAILURES ?? []);
  const project = () => env.GOOGLE_CLOUD_PROJECT!;
  const translation = env.TRANSLATION_PROVIDER_ORDER.map((name): TranslationProvider => {
    switch (name) {
      case 'fake':
        return new FakeTranslationProvider(failing.has('translation'));
      case 'google':
        return new GoogleTranslationProvider(project());
      case 'free':
        return new FreeTranslationProvider();
    }
  });
  const speech = env.TTS_PROVIDER_ORDER.map((name): SpeechProvider => {
    switch (name) {
      case 'fake':
        return new FakeSpeechProvider(failing.has('speech'));
      case 'google':
        return new GoogleSpeechProvider(project());
      case 'edge':
        return new EdgeSpeechProvider();
    }
  });
  return {
    translation: new ProviderChain('translation', translation),
    speech: new ProviderChain('speech', speech),
  };
}
