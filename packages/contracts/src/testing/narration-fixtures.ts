// Narration shapes for tests: RPC messages for stubbed peers, and catalog's localization source.
import {
  AudioStatus as ProtoAudioStatus,
  PlaceKind as ProtoPlaceKind,
  PlaceStatus as ProtoPlaceStatus,
  TranslationSource as ProtoTranslationSource,
} from '../generated/wayfare/catalog/place_types.pb';
import type { LocalizationSourcePlace } from '../generated/wayfare/catalog/localization_source.pb';
import { LocalizationTargetType as ProtoLocalizationTargetType } from '../generated/wayfare/common/localization.pb';
import {
  SynthesisJobStatus as ProtoSynthesisJobStatus,
  SynthesisStage as ProtoSynthesisStage,
  SynthesisTaskStatus as ProtoSynthesisTaskStatus,
  SynthesisTrigger as ProtoSynthesisTrigger,
} from '../generated/wayfare/narration/synthesis_admin.pb';
import type {
  SynthesisJob,
  SynthesisTask,
} from '../generated/wayfare/narration/synthesis_admin.pb';
import { newId } from '../common/ids';
import { SynthesisTrigger } from '../narration/enums';
import { FIXTURE_IDS } from './fixtures';
import { FIXTURE_TIMESTAMP } from './identity-rpc-fixtures';

/** Ids the narration fixtures use. */
export const NARRATION_FIXTURE_IDS = {
  job: '01990000-0000-7000-8000-000000000030',
  task: '01990000-0000-7000-8000-000000000031',
} as const;

const HASH = 'a'.repeat(64);

/** A job as `SynthesisAdminService` returns it. */
export function synthesisJobFixture(overrides: Partial<SynthesisJob> = {}): SynthesisJob {
  return {
    id: NARRATION_FIXTURE_IDS.job,
    targetType: ProtoLocalizationTargetType.LOCALIZATION_TARGET_TYPE_PLACE,
    targetId: FIXTURE_IDS.place,
    trigger: ProtoSynthesisTrigger.SYNTHESIS_TRIGGER_APPROVAL,
    sourceContentHash: HASH,
    requestedLangs: ['vi', 'en'],
    includeAudio: true,
    priority: 5,
    status: ProtoSynthesisJobStatus.SYNTHESIS_JOB_STATUS_RUNNING,
    totalTasks: 2,
    completedTasks: 1,
    failedTasks: 0,
    requestedByUserId: undefined,
    requestedByDeviceId: undefined,
    errorSummary: undefined,
    createdAt: FIXTURE_TIMESTAMP,
    startedAt: FIXTURE_TIMESTAMP,
    finishedAt: undefined,
    ...overrides,
  };
}

/** A task as `GetJob` returns it. */
export function synthesisTaskFixture(overrides: Partial<SynthesisTask> = {}): SynthesisTask {
  return {
    id: NARRATION_FIXTURE_IDS.task,
    lang: 'en',
    stage: ProtoSynthesisStage.SYNTHESIS_STAGE_SYNTHESIZE,
    status: ProtoSynthesisTaskStatus.SYNTHESIS_TASK_STATUS_RUNNING,
    attempts: 0,
    translationProvider: 'fake',
    speechProvider: undefined,
    voiceId: undefined,
    cacheKey: undefined,
    coalescedIntoTaskId: undefined,
    lastError: undefined,
    startedAt: FIXTURE_TIMESTAMP,
    finishedAt: undefined,
    ...overrides,
  };
}

/** A live Editorial Place as `GetLocalizationSource` returns it, with a ready `en` row. */
export function localizationSourcePlaceFixture(
  overrides: Partial<LocalizationSourcePlace> = {},
): LocalizationSourcePlace {
  return {
    kind: ProtoPlaceKind.PLACE_KIND_EDITORIAL,
    status: ProtoPlaceStatus.PLACE_STATUS_ACTIVE,
    deleted: false,
    contentHash: HASH,
    nameVi: 'Chợ Bến Thành',
    descriptionVi: 'Chợ có từ năm 1914.',
    ownerUserId: undefined,
    localizations: [
      {
        lang: 'en',
        name: 'Ben Thanh Market',
        description: 'A market since 1914.',
        sourceContentHash: HASH,
        translationSource: ProtoTranslationSource.TRANSLATION_SOURCE_MACHINE,
        audioStatus: ProtoAudioStatus.AUDIO_STATUS_READY,
        audioSourceContentHash: HASH,
        audioObjectPath: `audio/${'b'.repeat(64)}.mp3`,
        audioSha256: 'c'.repeat(64),
        audioBytes: 48_000,
        audioDurationMs: 31_000,
      },
    ],
    ...overrides,
  };
}

/** A complete `catalog.place.content_changed` payload: a fresh event id, `APPROVAL` by default. */
export function placeContentChangedFixture(input: {
  readonly placeId: string;
  readonly contentHash: string;
  readonly langs?: readonly string[];
  readonly trigger?: SynthesisTrigger.APPROVAL | SynthesisTrigger.CONTENT_CHANGED;
}) {
  return {
    eventId: newId(),
    occurredAt: new Date().toISOString(),
    placeId: input.placeId,
    contentHash: input.contentHash,
    langs: [...(input.langs ?? ['en', 'zh-Hans', 'ja', 'ko'])],
    trigger: input.trigger ?? SynthesisTrigger.APPROVAL,
  };
}

/** A complete `catalog.menu.content_changed` payload. */
export function menuContentChangedFixture(input: {
  readonly placeId: string;
  readonly menuItemIds: readonly string[];
  readonly langs?: readonly string[];
}) {
  return {
    eventId: newId(),
    occurredAt: new Date().toISOString(),
    placeId: input.placeId,
    menuItemIds: [...input.menuItemIds],
    langs: [...(input.langs ?? ['en'])],
  };
}
