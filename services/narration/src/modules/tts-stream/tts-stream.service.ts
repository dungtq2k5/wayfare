import { status } from '@grpc/grpc-js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LocalizationTargetType,
  MAX_LANGUAGE_CODE_LENGTH,
  NARRATION_LOCALIZATION_READY,
  normalizeLang,
  PlaceKind,
  PlaceStatus,
  scopeCoversLanguage,
  TTS_STREAM_TIMEOUT_MS,
  zUuidV7,
} from '@wayfare/contracts';
import type { EventInput, Language } from '@wayfare/contracts';
import {
  narrationLanguageScopeProto,
  placeKindProto,
  placeStatusProto,
} from '@wayfare/contracts/grpc';
import type { billingGrpc, catalogGrpc, narrationGrpc } from '@wayfare/contracts/grpc';
import {
  isGrpcServiceError,
  OutboxService,
  parseRpcRequest,
  requireDeviceContext,
  rpcError,
} from '@wayfare/nest-common';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { RequestContext } from '@wayfare/nest-common';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { Redis } from 'ioredis';
import { Counter } from 'prom-client';
import { z } from 'zod';
import { BillingServiceGrpcClient } from '../billing/billing-service-grpc.client';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { SynthesisService } from '../synthesis/synthesis.service';
import type { FoundAudio, LocalizedText, Speaker } from '../synthesis/synthesis.service';
import { audioCacheKey } from '../tasks/domain/cache-keys';
import { placeSsmlBody, wholeSsml } from '../tasks/domain/ssml';

/** Streams answered from a file that already existed, and from a synthesis this call made. */
const streamAudioTotal = new Counter({
  name: 'narration_tts_stream_total',
  help: 'Live stream requests by where their audio came from.',
  labelNames: ['outcome'] as const,
});

const placeLangFields = z.object({
  placeId: zUuidV7,
  // Any tag as sent: an unserved language is a refusal, not a malformed request.
  lang: z.string().min(1).max(MAX_LANGUAGE_CODE_LENGTH),
});

/** How long one caller holds the right to synthesize a cache key (rdm-spec N-3). */
const LOCK_TTL_MS = 30_000;

/** How often a waiter looks for the winner's file. */
const WAIT_POLL_MS = 200;

/** The MIME type every provider's audio carries (architecture §3.6). */
const AUDIO_CONTENT_TYPE = 'audio/mpeg';

/**
 * Audio tier 2 (api-endpoints-plan §4.1): the clip a tourist taps for before any job has made it.
 * It builds the same text and SSML a task would, so the bytes are the ones the pipeline would have
 * produced, and it stores what it makes through the ordinary path — the cache row, the object and
 * the `ready` event — so the next tourist is served tier 1 and catalog serves the file itself.
 *
 * One synthesis per cache key: the first caller takes a Redis lock and the others wait for its
 * file rather than buying a second one.
 */
@Injectable()
export class TtsStreamService {
  private readonly logger = new Logger(TtsStreamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly catalog: CatalogServiceGrpcClient,
    private readonly billing: BillingServiceGrpcClient,
    private readonly synthesis: SynthesisService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async getStreamAudio(
    request: narrationGrpc.GetStreamAudioRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.GetStreamAudioResponse> {
    requireDeviceContext(context);
    const fields = parseRpcRequest(placeLangFields, request);
    const place = await this.activePlace(fields.placeId);
    const lang = normalizeLang(fields.lang);
    // `vi` is the source and is spoken by the pipeline like any other language, but a tag narration
    // does not serve has no voice to answer with.
    if (lang === null) throw rpcError('INVALID_STATE', { status: 'NO_VOICE' });
    if (placeKindProto.fromProto(place.kind) === PlaceKind.VENUE) {
      await this.requireVenueLanguage(place.ownerUserId ?? null, lang);
    }
    const speakers = this.synthesis.speakersFor(lang);
    if (speakers.length === 0) throw rpcError('INVALID_STATE', { status: 'NO_VOICE' });

    const key = {
      targetType: LocalizationTargetType.PLACE as string,
      targetId: fields.placeId,
      lang,
      sourceContentHash: place.contentHash,
    };
    const text = await this.synthesis.localizedText(
      key,
      { name: place.nameVi, description: place.descriptionVi },
      true,
    );
    const body = placeSsmlBody({
      name: text.name,
      description: text.description ?? '',
      lang,
      rules: await this.synthesis.rulesFor(lang),
    });

    const stored = await this.synthesis.findAudio(lang, body, speakers);
    if (stored !== null) {
      streamAudioTotal.inc({ outcome: 'cached' });
      return this.answer(stored);
    }
    return this.makeOrWait(key, body, speakers, text);
  }

  /**
   * The winner synthesizes; everyone else waits for its file (rdm-spec N-3). A waiter whose winner failed is
   * answered `503` rather than queued behind a second attempt, and a lock whose holder died simply
   * expires — the next caller re-checks the cache before paying for a synthesis.
   */
  private async makeOrWait(
    key: { targetType: string; targetId: string; lang: string; sourceContentHash: string },
    body: string,
    speakers: readonly Speaker[],
    text: LocalizedText,
  ): Promise<narrationGrpc.GetStreamAudioResponse> {
    const cacheKey = audioCacheKey({
      ssml: wholeSsml(body),
      lang: key.lang,
      voiceId: speakers[0]!.voice.id,
      format: speakers[0]!.provider.format,
    });
    const lock = `narration:tts:${cacheKey}`;
    const held = await this.redis.set(lock, '1', 'PX', LOCK_TTL_MS, 'NX');
    if (held === null) return this.waitFor(lock, key.lang, body, speakers);

    try {
      const made = await this.synthesis.synthesize(key.lang, body);
      await this.publish(key, made, text);
      streamAudioTotal.inc({ outcome: 'synthesized' });
      return this.answer(made);
    } finally {
      // Released whether it worked or not: a waiter must learn of a failure now, not in 30 s.
      await this.redis.del(lock).catch(() => undefined);
    }
  }

  /** Waits for the winner's file, up to the service's own budget. */
  private async waitFor(
    lock: string,
    lang: string,
    body: string,
    speakers: readonly Speaker[],
  ): Promise<narrationGrpc.GetStreamAudioResponse> {
    const deadline = Date.now() + TTS_STREAM_TIMEOUT_MS;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
      const found = await this.synthesis.findAudio(lang, body, speakers);
      if (found !== null) {
        streamAudioTotal.inc({ outcome: 'waited' });
        return this.answer(found);
      }
      // The lock is gone and no file exists: the winner failed, and so does this call.
      if ((await this.redis.exists(lock)) === 0) {
        streamAudioTotal.inc({ outcome: 'failed' });
        throw rpcError('UPSTREAM_UNAVAILABLE');
      }
      if (Date.now() >= deadline) {
        streamAudioTotal.inc({ outcome: 'timeout' });
        throw rpcError('UPSTREAM_UNAVAILABLE');
      }
    }
  }

  /** The bytes themselves, read back from the object the pipeline would have served. */
  private async answer(audio: FoundAudio): Promise<narrationGrpc.GetStreamAudioResponse> {
    const bytes = await this.storage.download(audio.objectPath);
    return { audio: bytes, contentType: AUDIO_CONTENT_TYPE };
  }

  /**
   * The same `ready` a task publishes (api-endpoints-plan §10), so catalog serves this file from
   * now on and the tourist behind this one gets tier 1.
   */
  private async publish(
    key: { targetId: string; lang: string; sourceContentHash: string },
    audio: FoundAudio,
    text: LocalizedText,
  ): Promise<void> {
    const input: EventInput<typeof NARRATION_LOCALIZATION_READY> = {
      occurredAt: new Date().toISOString(),
      targetType: LocalizationTargetType.PLACE,
      targetId: key.targetId,
      lang: key.lang,
      sourceContentHash: key.sourceContentHash,
      translationSource: text.source,
      // A Place's event always carries a description: the name stands in when there is none, as
      // the pipeline's own publish does.
      text: { name: text.name, description: text.description ?? text.name },
      audio: {
        assetId: audio.assetId,
        objectPath: audio.objectPath,
        sha256: audio.sha256,
        bytes: audio.bytes,
        durationMs: audio.durationMs,
        voiceId: audio.voiceId,
        sourceContentHash: key.sourceContentHash,
      },
    };
    await this.prisma.$transaction((tx) =>
      this.outbox.add(tx, NARRATION_LOCALIZATION_READY, input),
    );
  }

  /** A Venue's languages are its owner's plan's, exactly as the on-demand route reads them. */
  private async requireVenueLanguage(ownerUserId: string | null, lang: Language): Promise<void> {
    if (ownerUserId === null) throw rpcError('LANGUAGE_NOT_ENTITLED');
    let answer: billingGrpc.GetEntitlementsResponse;
    try {
      answer = await this.billing.getEntitlements(ownerUserId);
    } catch (error) {
      if (isGrpcServiceError(error) && error.code === status.NOT_FOUND) {
        throw rpcError('LANGUAGE_NOT_ENTITLED');
      }
      this.logger.warn(
        { ownerUserId, kind: error instanceof Error ? error.name : 'unknown' },
        'billing did not answer the entitlements',
      );
      throw rpcError('ENTITLEMENTS_UNAVAILABLE');
    }
    const scope = narrationLanguageScopeProto.fromProto(
      answer.entitlements?.narrationLanguageScope,
    );
    if (scope === null || !scopeCoversLanguage(scope, lang)) {
      throw rpcError('LANGUAGE_NOT_ENTITLED');
    }
  }

  private async activePlace(placeId: string): Promise<catalogGrpc.LocalizationSourcePlace> {
    const source = await this.catalog.localizationSource(LocalizationTargetType.PLACE, placeId);
    const place = source.place ?? null;
    if (
      place === null ||
      place.deleted ||
      placeStatusProto.fromProto(place.status) !== PlaceStatus.ACTIVE
    ) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
    }
    return place;
  }
}
