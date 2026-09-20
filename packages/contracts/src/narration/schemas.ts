import { z } from 'zod';
import { AudioStatus } from '../catalog/enums';
import { zPlaceAudio } from '../catalog/sync';
import { PREFETCH_MAX_PLACES } from '../catalog/limits';
import { zUuidV7 } from '../common/ids';
import { MAX_LANGUAGE_CODE_LENGTH, zRequestedLanguage } from '../common/languages';
import { zSha256Hex } from '../events/event-definition';
import {
  LocalizationTargetType,
  SynthesisJobStatus,
  SynthesisStage,
  SynthesisTaskStatus,
  SynthesisTrigger,
  UiBundleNamespace,
  UiBundleStatus,
} from './enums';

const zInstant = z.iso.datetime({ offset: true });

/** What an on-demand request found (api-endpoints-plan §4.1). */
export enum OnDemandStatus {
  /** Audio exists for the current text. */
  READY = 'READY',
  /** A job is working on it; ask again after `retryAfterMs`. */
  PENDING = 'PENDING',
  /** Narration cannot serve this language; the device's own voice covers it. */
  UNAVAILABLE = 'UNAVAILABLE',
}

/** Every `OnDemandStatus` value. */
export const ON_DEMAND_STATUSES = Object.values(OnDemandStatus);

/** `POST /narration/on-demand` body. Any well-formed tag: an unserved one is not an error. */
export const zOnDemandRequest = z.object({ placeId: zUuidV7, lang: zRequestedLanguage }).strict();

/** The on-demand answer: `200` for `READY` and `UNAVAILABLE`, `202` for `PENDING`. */
export const zOnDemandResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal(OnDemandStatus.READY), audio: zPlaceAudio }).strict(),
  z
    .object({
      status: z.literal(OnDemandStatus.PENDING),
      jobId: zUuidV7,
      retryAfterMs: z.number().int().min(0),
    })
    .strict(),
  z.object({ status: z.literal(OnDemandStatus.UNAVAILABLE) }).strict(),
]);
/** The on-demand answer. */
export type OnDemandResponse = z.output<typeof zOnDemandResponse>;

/**
 * A Place's narration in one language (api-endpoints-plan §4.1). `audioStatus` is null while no
 * text exists; `audio` is present when it was made from the text being served.
 */
export const zNarrationStatus = z
  .object({
    textReady: z.boolean(),
    audioStatus: z.enum(AudioStatus).nullable(),
    audio: zPlaceAudio.nullable(),
    stale: z.boolean(),
  })
  .strict();
/** A Place's narration in one language. */
export type NarrationStatus = z.output<typeof zNarrationStatus>;

/** One synthesis job, as the monitor lists it (rdm-spec N-1). */
export const zSynthesisJobSummary = z
  .object({
    id: zUuidV7,
    targetType: z.enum(LocalizationTargetType),
    targetId: zUuidV7.nullable(),
    trigger: z.enum(SynthesisTrigger),
    sourceContentHash: zSha256Hex,
    requestedLangs: z.array(z.string()),
    includeAudio: z.boolean(),
    priority: z.number().int(),
    status: z.enum(SynthesisJobStatus),
    totalTasks: z.number().int().min(0),
    completedTasks: z.number().int().min(0),
    failedTasks: z.number().int().min(0),
    requestedByUserId: zUuidV7.nullable(),
    requestedByDeviceId: zUuidV7.nullable(),
    errorSummary: z.string().nullable(),
    createdAt: zInstant,
    startedAt: zInstant.nullable(),
    finishedAt: zInstant.nullable(),
  })
  .strict();
/** One synthesis job. */
export type SynthesisJobSummary = z.output<typeof zSynthesisJobSummary>;

/** One task of a job (rdm-spec N-2): the stage it is in, who answered, and a redacted error. */
export const zSynthesisTaskView = z
  .object({
    id: zUuidV7,
    lang: z.string(),
    stage: z.enum(SynthesisStage),
    status: z.enum(SynthesisTaskStatus),
    attempts: z.number().int().min(0),
    translationProvider: z.string().nullable(),
    speechProvider: z.string().nullable(),
    voiceId: z.string().nullable(),
    cacheKey: zSha256Hex.nullable(),
    coalescedIntoTaskId: zUuidV7.nullable(),
    lastError: z.string().nullable(),
    startedAt: zInstant.nullable(),
    finishedAt: zInstant.nullable(),
  })
  .strict();

/** A job with every task (api-endpoints-plan §4.3). */
export const zSynthesisJobDetail = zSynthesisJobSummary
  .extend({ tasks: z.array(zSynthesisTaskView) })
  .strict();
/** A job with every task. */
export type SynthesisJobDetail = z.output<typeof zSynthesisJobDetail>;

/** One provider's health, as this process sees it (api-endpoints-plan §4.3). */
export const zProviderHealth = z
  .object({
    name: z.string(),
    role: z.enum(['translation', 'speech']),
    /** Its place in the configured order, from 0. */
    position: z.number().int().min(0),
    /** `open` while it is skipped for the cooldown. */
    breaker: z.enum(['closed', 'open']),
    consecutiveFailures: z.number().int().min(0),
    /** Failures over the last `recentCalls`, 0 to 1. */
    errorRate: z.number().min(0).max(1),
    recentCalls: z.number().int().min(0),
    coolingUntil: zInstant.nullable(),
    /** Each narration replica has its own breakers. */
    scope: z.literal('process'),
  })
  .strict();
/** One provider's health. */
export type ProviderHealth = z.output<typeof zProviderHealth>;

/** The pinned voice and the provider's catalogue for one language (api-endpoints-plan §4.3). */
export const zVoiceCatalogue = z
  .object({
    lang: z.string(),
    provider: z.string(),
    pinnedVoiceId: z.string().nullable(),
    available: z.array(
      z
        .object({
          id: z.string(),
          languageCode: z.string(),
          gender: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
/** One language's voices. */
export type VoiceCatalogue = z.output<typeof zVoiceCatalogue>;

/** `POST /narration/hotset` body — a language switch's warmup (api-endpoints-plan §4.1). */
export const zHotsetRequest = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    lang: zRequestedLanguage,
  })
  .strict();
/** A hotset request. */
export type HotsetRequest = z.output<typeof zHotsetRequest>;

/**
 * What the warmup found: the Places a tourist can already hear, the ones being made, and how many
 * of them the switch waits for — the count travels so the client never holds it.
 */
export const zHotsetResponse = z
  .object({
    ready: z.array(zUuidV7),
    pending: z.array(zUuidV7),
    requiredReadyCount: z.number().int().min(0),
  })
  .strict();
/** A hotset answer. */
export type HotsetResponse = z.output<typeof zHotsetResponse>;

/** `POST /narration/prefetch` body: at most `PREFETCH_MAX_PLACES` ids (api-endpoints-plan §4.1). */
export const zPrefetchRequest = z
  .object({
    placeIds: z.array(zUuidV7).min(1).max(PREFETCH_MAX_PLACES),
    lang: zRequestedLanguage,
  })
  .strict();
/** A prefetch request. */
export type PrefetchRequest = z.output<typeof zPrefetchRequest>;

/** What the prefetch queued, and what it passed over: already ready, unknown or not live. */
export const zPrefetchResponse = z
  .object({ queued: z.array(zUuidV7), skipped: z.array(zUuidV7) })
  .strict();
/** A prefetch answer. */
export type PrefetchResponse = z.output<typeof zPrefetchResponse>;

/** `GET /narration/tts/stream` query — audio tier 2 (api-endpoints-plan §4.1). */
export const zStreamRequest = z.object({ placeId: zUuidV7, lang: zRequestedLanguage }).strict();
/** A stream request. */
export type StreamRequest = z.output<typeof zStreamRequest>;

/**
 * `GET /i18n/bundles/:namespace/:locale` (api-endpoints-plan §4.2). `PENDING` carries the English
 * strings, so a client renders something immediately and asks again after `retryAfterMs`.
 */
export const zUiBundleResponse = z
  .object({
    namespace: z.enum(UiBundleNamespace),
    locale: z.string().min(2).max(MAX_LANGUAGE_CODE_LENGTH),
    status: z.enum([UiBundleStatus.READY, UiBundleStatus.PENDING]),
    sourceHash: zSha256Hex,
    messages: z.record(z.string(), z.string()),
    /** Keys whose translation broke an ICU placeholder and are served in English (rdm-spec N-6). */
    failedKeys: z.array(z.string()),
    /** `PENDING` only. */
    retryAfterMs: z.number().int().min(0).nullable(),
  })
  .strict();
/** One UI string bundle. */
export type UiBundleResponse = z.output<typeof zUiBundleResponse>;
