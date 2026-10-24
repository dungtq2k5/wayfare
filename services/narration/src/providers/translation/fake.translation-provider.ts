import type { Language } from '@wayfare/contracts';
import { TranslationProvider } from './translation-provider';
import { fakeFailureError } from '../fake-failure';
import type { FakeFailure } from '../fake-failure';

/**
 * The local and test default: `[<lang>] text`, and `vi` → `vi` unchanged. Deterministic and
 * instant; fails every call when told to (`FAKE_PROVIDER_FAILURES`).
 */
export class FakeTranslationProvider extends TranslationProvider {
  readonly name = 'fake' as const;

  constructor(private readonly failing: FakeFailure = false) {
    super();
  }

  supports(): boolean {
    return true;
  }

  translate(input: { text: string; from: 'vi'; to: Language }): Promise<string> {
    const failure = fakeFailureError('translation', this.failing);
    if (failure !== null) return Promise.reject(failure);
    return Promise.resolve(input.to === 'vi' ? input.text : `[${input.to}] ${input.text}`);
  }
}
