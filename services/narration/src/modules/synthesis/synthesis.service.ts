import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MAX_LOCALIZED_TEXT_LENGTH,
  MAX_MENU_ITEM_DESCRIPTION_LENGTH,
  MAX_MENU_ITEM_NAME_LENGTH,
  MAX_PLACE_NAME_LENGTH,
  OverrideStatus,
  SOURCE_LANGUAGE,
  TranslationSource,
} from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { Counter } from 'prom-client';
import { voiceFor } from '../../config/voices';
import { InputRefusedError } from '../../providers/provider-chain';
import type { SpeechProvider, VoiceSpec } from '../../providers/speech/speech-provider';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersHealthService } from '../providers-health/providers-health.service';
import { audioCacheKey, translationCacheKey } from '../tasks/domain/cache-keys';
import { joinMp3 } from '../tasks/domain/mp3';
import { splitSsml, wholeSsml } from '../tasks/domain/ssml';
import type { PronunciationRule } from '../tasks/domain/ssml';

/** Cached audio rows whose object was gone, so the caller synthesized again (rdm-spec N-3). */
const audioCacheMissingTotal = new Counter({
  name: 'narration_audio_cache_missing_total',
  help: 'Cached audio rows whose stored object was gone.',
});

/** The cache policy of a stored audio file: content-addressed, so immutable (architecture §3.6). */
const AUDIO_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** What is being localized: one target in one language, at one version of its source. */
export interface LocalizationKey {
  readonly targetType: string;
  readonly targetId: string;
  readonly lang: string;
  readonly sourceContentHash: string;
}

/** The Vietnamese a target holds now. */
export interface SourceText {
  readonly name: string;
  readonly description: string | null;
}

/** A target's text in one language, and where it came from. */
export interface LocalizedText {
  readonly name: string;
  readonly description: string | null;
  readonly source: TranslationSource;
  /** The provider that translated a field, when one did. */
  readonly provider: string | null;
}

/** A stored or found audio file, as `ready` carries it. */
export interface Audio {
  readonly assetId: string;
  readonly objectPath: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly durationMs: number;
  readonly voiceId: string;
}

/** A found file, with what produced it — the task records these on its row. */
export interface FoundAudio extends Audio {
  readonly cacheKey: string;
  readonly speechProvider: string;
}

/** A speech provider with its pinned voice for a language. */
export type Speaker = { readonly provider: SpeechProvider; readonly voice: VoiceSpec };

/** Cuts text to `max` without splitting a surrogate pair. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * The steps that turn a target's source text into audio: the translation and its corrections, the
 * dictionary, the audio cache and the store (rdm-spec N-3, N-4, N-5, N-7). The pipeline runs them
 * for a task and the live stream runs them for one tourist's tap (api-endpoints-plan §4.1), and
 * they must produce byte-identical audio either way — so they live here once rather than twice.
 */
@Injectable()
export class SynthesisService {
  private readonly logger = new Logger(SynthesisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersHealthService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * The text in the key's language: a staff correction, the source itself, or a translation. A
   * correction held for an older version is retired on the way past (rdm-spec N-7),
   * so nothing has to sweep the table later.
   */
  async localizedText(
    key: LocalizationKey,
    source: SourceText,
    isPlace: boolean,
  ): Promise<LocalizedText> {
    const nameMax = isPlace ? MAX_PLACE_NAME_LENGTH : MAX_MENU_ITEM_NAME_LENGTH;
    const descriptionMax = isPlace ? MAX_LOCALIZED_TEXT_LENGTH : MAX_MENU_ITEM_DESCRIPTION_LENGTH;
    const shaped = (
      name: string,
      description: string | null,
      origin: TranslationSource,
      provider: string | null,
    ): LocalizedText => ({
      name: clamp(name, nameMax),
      description:
        description === null || description === '' ? null : clamp(description, descriptionMax),
      source: origin,
      provider,
    });

    if (key.lang === SOURCE_LANGUAGE) {
      return shaped(source.name, source.description, TranslationSource.SOURCE, null);
    }
    const held = await this.prisma.localizationOverride.findMany({
      where: {
        targetType: key.targetType,
        targetId: key.targetId,
        lang: key.lang,
        status: OverrideStatus.ACTIVE,
      },
      select: { id: true, name: true, description: true, sourceContentHash: true },
    });
    const override = held.find((row) => row.sourceContentHash === key.sourceContentHash) ?? null;
    const stale = held.filter((row) => row.sourceContentHash !== key.sourceContentHash);
    if (stale.length > 0) {
      await this.prisma.localizationOverride.updateMany({
        where: { id: { in: stale.map((row) => row.id) } },
        // No `reverted_by_id`: superseded by a source change, not by a person.
        data: { status: OverrideStatus.REVERTED },
      });
    }
    const name =
      override === null
        ? await this.translateField(key.lang, source.name)
        : { text: override.name, provider: null };
    const description =
      override?.description != null
        ? { text: override.description, provider: null }
        : source.description === null || source.description === ''
          ? null
          : await this.translateField(key.lang, source.description);
    return shaped(
      name.text,
      description?.text ?? null,
      override === null ? TranslationSource.MACHINE : TranslationSource.HUMAN,
      description?.provider ?? name.provider,
    );
  }

  /** One field through the translation cache (rdm-spec N-4), then the chain on a miss. */
  async translateField(
    lang: string,
    text: string,
  ): Promise<{ text: string; provider: string | null }> {
    const cacheKey = translationCacheKey({ sourceLang: SOURCE_LANGUAGE, targetLang: lang, text });
    const cached = await this.prisma.translationCache.findUnique({
      where: { cacheKey },
      select: { translatedText: true, provider: true },
    });
    if (cached !== null) {
      await this.prisma.translationCache.update({
        where: { cacheKey },
        data: { lastUsedAt: new Date() },
        select: { cacheKey: true },
      });
      return { text: cached.translatedText, provider: cached.provider };
    }
    const chain = this.providers.chains.translation;
    const to = lang as Language;
    if (!chain.providers.some((provider) => provider.supports(to))) {
      throw new InputRefusedError('UNSUPPORTED_LANGUAGE');
    }
    const { result, provider } = await chain.run(
      (candidate) => candidate.supports(to),
      (candidate) => candidate.translate({ text, from: SOURCE_LANGUAGE, to }),
    );
    await this.prisma.translationCache.createMany({
      data: [
        {
          cacheKey,
          sourceLang: SOURCE_LANGUAGE,
          targetLang: lang,
          translatedText: result,
          provider: provider.name,
          sourceChars: text.length,
        },
      ],
      skipDuplicates: true,
    });
    return { text: result, provider: provider.name };
  }

  /** The configured speech providers with a pinned voice for `lang`, in chain order. */
  speakersFor(lang: string): Speaker[] {
    return this.providers.chains.speech.providers.flatMap((provider) => {
      const voice = voiceFor(provider.name, lang);
      return voice === null ? [] : [{ provider, voice }];
    });
  }

  /** The active dictionary entries for `lang` and for every language (rdm-spec N-5). */
  async rulesFor(lang: string): Promise<PronunciationRule[]> {
    if (lang === SOURCE_LANGUAGE) return [];
    const rows = await this.prisma.pronunciationEntry.findMany({
      where: { isActive: true, OR: [{ targetLang: lang }, { targetLang: null }] },
      select: {
        term: true,
        targetLang: true,
        replacementType: true,
        replacement: true,
        alphabet: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      replacementType: row.replacementType as 'SUB' | 'PHONEME',
    }));
  }

  /** A stored file for this SSML under any configured provider's voice and format: a cache hit. */
  async findAudio(
    lang: string,
    body: string,
    speakers: readonly Speaker[],
  ): Promise<FoundAudio | null> {
    const ssml = wholeSsml(body);
    for (const { provider, voice } of speakers) {
      const cacheKey = audioCacheKey({ ssml, lang, voiceId: voice.id, format: provider.format });
      const asset = await this.prisma.audioAsset.findUnique({
        where: { cacheKey },
        select: {
          id: true,
          objectPath: true,
          sha256: true,
          bytes: true,
          durationMs: true,
          voiceId: true,
        },
      });
      if (asset === null) continue;
      // The row is a claim about a file in a bucket, and the two can disagree — a lost bucket, a
      // lifecycle rule, a mistaken delete (rdm-spec N-3). A definite not-found is a miss, so the
      // caller synthesizes and stores again over the same path. Any other storage failure is the
      // caller's failure: an unreachable bucket must not re-synthesize every cache hit.
      if ((await this.storage.stat(asset.objectPath)) === null) {
        audioCacheMissingTotal.inc();
        this.logger.warn(
          { cacheKey, objectPath: asset.objectPath, audioAssetId: asset.id },
          'a cached audio object is gone; synthesizing again',
        );
        continue;
      }
      return {
        assetId: asset.id,
        objectPath: asset.objectPath,
        sha256: asset.sha256,
        bytes: asset.bytes,
        durationMs: asset.durationMs,
        voiceId: asset.voiceId,
        cacheKey,
        speechProvider: provider.name,
      };
    }
    return null;
  }

  /**
   * Synthesizes the SSML chunk by chunk through the chain, joins and stores it (rdm-spec N-3).
   * `onStore` runs once the provider has answered and the cache key is known, before the upload —
   * the pipeline records the key on its task there, so a retry resumes at `STORE`.
   */
  async synthesize(
    lang: string,
    body: string,
    onStore?: (info: {
      readonly speechProvider: string;
      readonly voiceId: string;
      readonly cacheKey: string;
    }) => Promise<void>,
  ): Promise<FoundAudio> {
    const { result, provider } = await this.providers.chains.speech.run(
      (candidate) => voiceFor(candidate.name, lang) !== null,
      async (candidate) => {
        const voice = voiceFor(candidate.name, lang)!;
        const split = splitSsml(body, candidate.maxInputBytes);
        if (!split.ok) throw new InputRefusedError(split.reason);
        const parts: Buffer[] = [];
        for (const ssml of split.chunks) {
          const part = await candidate.synthesize({ ssml, voice });
          if (part.length === 0) throw new Error('empty result');
          parts.push(part);
        }
        return { parts, voice };
      },
    );
    const ssml = wholeSsml(body);
    const cacheKey = audioCacheKey({
      ssml,
      lang,
      voiceId: result.voice.id,
      format: provider.format,
    });
    await onStore?.({ speechProvider: provider.name, voiceId: result.voice.id, cacheKey });

    const joined = joinMp3(result.parts);
    if (!joined.ok) throw new Error(`the provider's audio is not MP3: ${joined.reason}`);
    const objectPath = `audio/${cacheKey}.mp3`;
    await this.storage.upload(objectPath, joined.data, {
      contentType: 'audio/mpeg',
      cacheControl: AUDIO_CACHE_CONTROL,
    });
    // A concurrent caller may have stored the same file: the first row stays.
    await this.prisma.audioAsset.createMany({
      data: [
        {
          cacheKey,
          lang,
          voiceId: result.voice.id,
          provider: provider.name,
          format: provider.format,
          objectPath,
          sha256: createHash('sha256').update(joined.data).digest('hex'),
          bytes: joined.data.length,
          durationMs: joined.durationMs,
          ssmlChars: ssml.length,
        },
      ],
      skipDuplicates: true,
    });
    const asset = await this.prisma.audioAsset.findUniqueOrThrow({
      where: { cacheKey },
      select: {
        id: true,
        objectPath: true,
        sha256: true,
        bytes: true,
        durationMs: true,
        voiceId: true,
      },
    });
    return {
      assetId: asset.id,
      objectPath: asset.objectPath,
      sha256: asset.sha256,
      bytes: asset.bytes,
      durationMs: asset.durationMs,
      voiceId: asset.voiceId,
      cacheKey,
      speechProvider: provider.name,
    };
  }
}
