import { CONTENT_LANGUAGES, LONG_TAIL_LANGUAGES } from '../common/languages';

/** Where a localized text came from (also C-7, C-9; B-8 uses a subset) — rdm-spec C-4 `translation_source`. */
export enum TranslationSource {
  SOURCE = 'SOURCE',
  MACHINE = 'MACHINE',
  HUMAN = 'HUMAN',
}

/** Every `TranslationSource` value. */
export const TRANSLATION_SOURCES = Object.values(TranslationSource);

/** What a synthesis job localizes — rdm-spec N-1 `target_type`. */
export enum LocalizationTargetType {
  PLACE = 'PLACE',
  MENU_ITEM = 'MENU_ITEM',
  TOUR = 'TOUR',
  VOUCHER_OFFER = 'VOUCHER_OFFER',
  UI_BUNDLE = 'UI_BUNDLE',
}

/** Every `LocalizationTargetType` value. */
export const LOCALIZATION_TARGET_TYPES = Object.values(LocalizationTargetType);

/** Why a synthesis job exists — rdm-spec N-1 `trigger`. */
export enum SynthesisTrigger {
  APPROVAL = 'APPROVAL',
  CONTENT_CHANGED = 'CONTENT_CHANGED',
  ON_DEMAND = 'ON_DEMAND',
  PREFETCH = 'PREFETCH',
  HOTSET = 'HOTSET',
  WARMUP = 'WARMUP',
  DICTIONARY_CHANGED = 'DICTIONARY_CHANGED',
  ENTITLEMENT_EXPANDED = 'ENTITLEMENT_EXPANDED',
  HUMAN_EDIT = 'HUMAN_EDIT',
  HUMAN_REVERT = 'HUMAN_REVERT',
  MANUAL = 'MANUAL',
}

/** Every `SynthesisTrigger` value. */
export const SYNTHESIS_TRIGGERS = Object.values(SynthesisTrigger);

/** A synthesis job's state — rdm-spec N-1 `status`. */
export enum SynthesisJobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  PARTIALLY_FAILED = 'PARTIALLY_FAILED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  SUPERSEDED = 'SUPERSEDED',
}

/** Every `SynthesisJobStatus` value. */
export const SYNTHESIS_JOB_STATUSES = Object.values(SynthesisJobStatus);

/** A synthesis task step — rdm-spec N-2 `stage`. */
export enum SynthesisStage {
  TRANSLATE = 'TRANSLATE',
  PRONOUNCE = 'PRONOUNCE',
  SYNTHESIZE = 'SYNTHESIZE',
  STORE = 'STORE',
  PUBLISH = 'PUBLISH',
}

/** Every `SynthesisStage` value. */
export const SYNTHESIS_STAGES = Object.values(SynthesisStage);

/** A synthesis task's state — rdm-spec N-2 `status`. */
export enum SynthesisTaskStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  COALESCED = 'COALESCED',
}

/** Every `SynthesisTaskStatus` value. */
export const SYNTHESIS_TASK_STATUSES = Object.values(SynthesisTaskStatus);

/** How a pronunciation entry rewrites text — rdm-spec N-5 `replacement_type`. */
export enum ReplacementType {
  SUB = 'SUB',
  PHONEME = 'PHONEME',
}

/** Every `ReplacementType` value. */
export const REPLACEMENT_TYPES = Object.values(ReplacementType);

/** A UI string bundle's state — rdm-spec N-6 `status`. */
export enum UiBundleStatus {
  PENDING = 'PENDING',
  READY = 'READY',
  FAILED = 'FAILED',
}

/** Every `UiBundleStatus` value. */
export const UI_BUNDLE_STATUSES = Object.values(UiBundleStatus);

/** Which app's strings a bundle holds — rdm-spec N-6 `namespace`. */
export enum UiBundleNamespace {
  TOURIST = 'tourist',
  CONSOLE = 'console',
}

/** Every `UiBundleNamespace` value. */
export const UI_BUNDLE_NAMESPACES = Object.values(UiBundleNamespace);

/** Where a UI string bundle came from — rdm-spec N-6 `origin`. */
export enum UiBundleOrigin {
  STATIC = 'STATIC',
  MACHINE = 'MACHINE',
}

/** Every `UiBundleOrigin` value. */
export const UI_BUNDLE_ORIGINS = Object.values(UiBundleOrigin);

/** What a translation correction targets — a subset of `LocalizationTargetType`, same values — rdm-spec N-7 `target_type`. */
export enum OverrideTargetType {
  PLACE = 'PLACE',
  TOUR = 'TOUR',
  MENU_ITEM = 'MENU_ITEM',
}

/** Every `OverrideTargetType` value. */
export const OVERRIDE_TARGET_TYPES = Object.values(OverrideTargetType);

/** A translation correction's state — rdm-spec N-7 `status`. */
export enum OverrideStatus {
  ACTIVE = 'ACTIVE',
  REVERTED = 'REVERTED',
}

/** Every `OverrideStatus` value. */
export const OVERRIDE_STATUSES = Object.values(OverrideStatus);

/** The sources a voucher offer's localization may have — B-8 never uses `HUMAN` (rdm-spec B-8). */
export const OFFER_TRANSLATION_SOURCES = [
  TranslationSource.SOURCE,
  TranslationSource.MACHINE,
] as const;
/** A voucher offer localization's source. */
export type OfferTranslationSource = (typeof OFFER_TRANSLATION_SOURCES)[number];

/** BullMQ priority per trigger, lower runs first (rdm-spec N-1). */
export const SYNTHESIS_PRIORITY: Readonly<Record<SynthesisTrigger, number>> = {
  [SynthesisTrigger.ON_DEMAND]: 1,
  [SynthesisTrigger.HOTSET]: 2,
  [SynthesisTrigger.HUMAN_EDIT]: 4,
  [SynthesisTrigger.HUMAN_REVERT]: 4,
  [SynthesisTrigger.MANUAL]: 4,
  [SynthesisTrigger.APPROVAL]: 5,
  [SynthesisTrigger.CONTENT_CHANGED]: 5,
  [SynthesisTrigger.PREFETCH]: 7,
  [SynthesisTrigger.WARMUP]: 9,
  [SynthesisTrigger.DICTIONARY_CHANGED]: 9,
  [SynthesisTrigger.ENTITLEMENT_EXPANDED]: 9,
};

/** Upper bound of an event's language list — every served language once. */
export const MAX_LANGS_PER_EVENT = CONTENT_LANGUAGES.length + LONG_TAIL_LANGUAGES.length;

/** Upper bound of a synthesis failure reason (rdm-spec N-2). */
export const MAX_FAILURE_REASON_LENGTH = 500;

/** How many TTS jobs run at once (product-overview §9). */
export const MAX_CONCURRENT_TTS_JOBS = 3;

/** How long a provider that failed is skipped (conventions §11.5). */
export const PROVIDER_COOLDOWN_MS = 60_000;
