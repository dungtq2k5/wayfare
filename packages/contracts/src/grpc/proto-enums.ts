import { SessionClient } from '../access/clients';
import {
  BillingEventStatus,
  BillingInterval,
  StripeEndpoint,
  SubscriptionStatus,
} from '../billing/enums';
import { AnalyticsLevel, NarrationLanguageScope } from '../entitlements/entitlements';
import {
  BillingInterval as ProtoBillingInterval,
  SubscriptionStatus as ProtoSubscriptionStatus,
} from '../generated/wayfare/billing/billing.pb';
import {
  BillingEventStatus as ProtoBillingEventStatus,
  StripeEndpoint as ProtoStripeEndpoint,
} from '../generated/wayfare/billing/billing_webhook.pb';
import {
  AnalyticsLevel as ProtoAnalyticsLevel,
  NarrationLanguageScope as ProtoNarrationLanguageScope,
} from '../generated/wayfare/billing/entitlement.pb';
import {
  AudioStatus,
  CategoryAppliesTo,
  MapPackStatus,
  PlaceInactiveReason,
  PlaceKind,
  PlaceStatus,
  SubmissionKind,
  SubmissionStatus,
  UploadPurpose,
} from '../catalog/enums';
import { ContentTier } from '../catalog/localization';
import { OverrideStatus, ReplacementType } from '../narration/enums';
import { OverrideStatus as ProtoOverrideStatus } from '../generated/wayfare/narration/correction.pb';
import { ReplacementType as ProtoReplacementType } from '../generated/wayfare/narration/pronunciation.pb';
import { protoEnumBridge } from '../common/proto-enum-bridge';
import { SessionClient as ProtoSessionClient } from '../generated/wayfare/identity/auth.pb';
import { Platform as ProtoPlatform } from '../generated/wayfare/identity/device.pb';
import {
  LegalDocument as ProtoLegalDocument,
  LegalParty as ProtoLegalParty,
} from '../generated/wayfare/identity/user.pb';
import {
  EmailBounceType as ProtoEmailBounceType,
  EmailDeliveryStatus as ProtoEmailDeliveryStatus,
  EmailTemplate as ProtoEmailTemplate,
} from '../generated/wayfare/identity/admin_user.pb';
import { ActionTokenPurpose as ProtoActionTokenPurpose } from '../generated/wayfare/identity/password.pb';
import { OwnerRegistrationStatus as ProtoOwnerRegistrationStatus } from '../generated/wayfare/identity/owner.pb';
import {
  AudioStatus as ProtoAudioStatus,
  CategoryAppliesTo as ProtoCategoryAppliesTo,
  ContentTier as ProtoContentTier,
  MapPackStatus as ProtoMapPackStatus,
  MenuCurrency as ProtoMenuCurrency,
  PlaceInactiveReason as ProtoPlaceInactiveReason,
  PlaceKind as ProtoPlaceKind,
  PlaceStatus as ProtoPlaceStatus,
  TranslationSource as ProtoTranslationSource,
} from '../generated/wayfare/catalog/place_types.pb';
import {
  SubmissionKind as ProtoSubmissionKind,
  SubmissionStatus as ProtoSubmissionStatus,
} from '../generated/wayfare/catalog/submission.pb';
import { UploadPurpose as ProtoUploadPurpose } from '../generated/wayfare/catalog/upload.pb';
import { MenuCurrency } from '../money/display-price';
import {
  LocalizationTargetType,
  SynthesisJobStatus,
  SynthesisStage,
  SynthesisTaskStatus,
  SynthesisTrigger,
  TranslationSource,
} from '../narration/enums';
import { OnDemandStatus } from '../narration/schemas';
import { LocalizationTargetType as ProtoLocalizationTargetType } from '../generated/wayfare/common/localization.pb';
import { OnDemandStatus as ProtoOnDemandStatus } from '../generated/wayfare/narration/narration.pb';
import {
  SynthesisJobStatus as ProtoSynthesisJobStatus,
  SynthesisStage as ProtoSynthesisStage,
  SynthesisTaskStatus as ProtoSynthesisTaskStatus,
  SynthesisTrigger as ProtoSynthesisTrigger,
} from '../generated/wayfare/narration/synthesis_admin.pb';
import {
  ActionTokenPurpose,
  LegalDocument,
  OwnerRegistrationStatus,
  Platform,
} from '../identity/enums';
import { EmailBounceType, EmailDeliveryStatus, EmailTemplate } from '../notifications/types';
import { LegalParty } from '../identity/legal';

/** `Platform` ⇄ `wayfare.identity.Platform`. */
export const platformProto = protoEnumBridge('Platform', Platform, ProtoPlatform);

/** `SessionClient` ⇄ `wayfare.identity.SessionClient`. */
export const sessionClientProto = protoEnumBridge(
  'SessionClient',
  SessionClient,
  ProtoSessionClient,
);

/** `LegalDocument` ⇄ `wayfare.identity.LegalDocument`. */
export const legalDocumentProto = protoEnumBridge(
  'LegalDocument',
  LegalDocument,
  ProtoLegalDocument,
);

/** `LegalParty` ⇄ `wayfare.identity.LegalParty`. */
export const legalPartyProto = protoEnumBridge('LegalParty', LegalParty, ProtoLegalParty);

/** `ActionTokenPurpose` ⇄ `wayfare.identity.ActionTokenPurpose`. */
export const actionTokenPurposeProto = protoEnumBridge(
  'ActionTokenPurpose',
  ActionTokenPurpose,
  ProtoActionTokenPurpose,
);

/** `EmailTemplate` ⇄ `wayfare.identity.EmailTemplate`. */
export const emailTemplateProto = protoEnumBridge(
  'EmailTemplate',
  EmailTemplate,
  ProtoEmailTemplate,
);

/** `EmailDeliveryStatus` ⇄ `wayfare.identity.EmailDeliveryStatus`. */
export const emailDeliveryStatusProto = protoEnumBridge(
  'EmailDeliveryStatus',
  EmailDeliveryStatus,
  ProtoEmailDeliveryStatus,
);

/** `EmailBounceType` ⇄ `wayfare.identity.EmailBounceType`. */
export const emailBounceTypeProto = protoEnumBridge(
  'EmailBounceType',
  EmailBounceType,
  ProtoEmailBounceType,
);

/** `OwnerRegistrationStatus` ⇄ `wayfare.identity.OwnerRegistrationStatus`. */
export const ownerRegistrationStatusProto = protoEnumBridge(
  'OwnerRegistrationStatus',
  OwnerRegistrationStatus,
  ProtoOwnerRegistrationStatus,
);

/** `PlaceKind` ⇄ `wayfare.catalog.PlaceKind`. */
export const placeKindProto = protoEnumBridge('PlaceKind', PlaceKind, ProtoPlaceKind);

/** `PlaceStatus` ⇄ `wayfare.catalog.PlaceStatus`. */
export const placeStatusProto = protoEnumBridge('PlaceStatus', PlaceStatus, ProtoPlaceStatus);

/** `PlaceInactiveReason` ⇄ `wayfare.catalog.PlaceInactiveReason`. */
export const placeInactiveReasonProto = protoEnumBridge(
  'PlaceInactiveReason',
  PlaceInactiveReason,
  ProtoPlaceInactiveReason,
);

/** `CategoryAppliesTo` ⇄ `wayfare.catalog.CategoryAppliesTo`. */
export const categoryAppliesToProto = protoEnumBridge(
  'CategoryAppliesTo',
  CategoryAppliesTo,
  ProtoCategoryAppliesTo,
);

/** `MapPackStatus` ⇄ `wayfare.catalog.MapPackStatus`. */
export const mapPackStatusProto = protoEnumBridge(
  'MapPackStatus',
  MapPackStatus,
  ProtoMapPackStatus,
);

/** `ReplacementType` ⇄ `wayfare.narration.ReplacementType`. */
export const replacementTypeProto = protoEnumBridge(
  'ReplacementType',
  ReplacementType,
  ProtoReplacementType,
);

/** `OverrideStatus` ⇄ `wayfare.narration.OverrideStatus`. */
export const overrideStatusProto = protoEnumBridge(
  'OverrideStatus',
  OverrideStatus,
  ProtoOverrideStatus,
);

/** `AudioStatus` ⇄ `wayfare.catalog.AudioStatus`. */
export const audioStatusProto = protoEnumBridge('AudioStatus', AudioStatus, ProtoAudioStatus);

/** `TranslationSource` ⇄ `wayfare.catalog.TranslationSource`. */
export const translationSourceProto = protoEnumBridge(
  'TranslationSource',
  TranslationSource,
  ProtoTranslationSource,
);

/** `UploadPurpose` ⇄ `wayfare.catalog.UploadPurpose`. */
export const uploadPurposeProto = protoEnumBridge(
  'UploadPurpose',
  UploadPurpose,
  ProtoUploadPurpose,
);

/** `SubmissionKind` ⇄ `wayfare.catalog.SubmissionKind`. */
export const submissionKindProto = protoEnumBridge(
  'SubmissionKind',
  SubmissionKind,
  ProtoSubmissionKind,
);

/** `SubmissionStatus` ⇄ `wayfare.catalog.SubmissionStatus`. */
export const submissionStatusProto = protoEnumBridge(
  'SubmissionStatus',
  SubmissionStatus,
  ProtoSubmissionStatus,
);

/** `MenuCurrency` ⇄ `wayfare.catalog.MenuCurrency`. */
export const menuCurrencyProto = protoEnumBridge('MenuCurrency', MenuCurrency, ProtoMenuCurrency);

/** `ContentTier` ⇄ `wayfare.catalog.ContentTier`. */
export const contentTierProto = protoEnumBridge('ContentTier', ContentTier, ProtoContentTier);

/** `LocalizationTargetType` ⇄ `wayfare.common.LocalizationTargetType`. */
export const localizationTargetTypeProto = protoEnumBridge(
  'LocalizationTargetType',
  LocalizationTargetType,
  ProtoLocalizationTargetType,
);

/** `SynthesisTrigger` ⇄ `wayfare.narration.SynthesisTrigger`. */
export const synthesisTriggerProto = protoEnumBridge(
  'SynthesisTrigger',
  SynthesisTrigger,
  ProtoSynthesisTrigger,
);

/** `SynthesisJobStatus` ⇄ `wayfare.narration.SynthesisJobStatus`. */
export const synthesisJobStatusProto = protoEnumBridge(
  'SynthesisJobStatus',
  SynthesisJobStatus,
  ProtoSynthesisJobStatus,
);

/** `SynthesisStage` ⇄ `wayfare.narration.SynthesisStage`. */
export const synthesisStageProto = protoEnumBridge(
  'SynthesisStage',
  SynthesisStage,
  ProtoSynthesisStage,
);

/** `SynthesisTaskStatus` ⇄ `wayfare.narration.SynthesisTaskStatus`. */
export const synthesisTaskStatusProto = protoEnumBridge(
  'SynthesisTaskStatus',
  SynthesisTaskStatus,
  ProtoSynthesisTaskStatus,
);

/** `OnDemandStatus` ⇄ `wayfare.narration.OnDemandStatus`. */
export const onDemandStatusProto = protoEnumBridge(
  'OnDemandStatus',
  OnDemandStatus,
  ProtoOnDemandStatus,
);

/** `SubscriptionStatus` ⇄ `wayfare.billing.SubscriptionStatus`. */
export const subscriptionStatusProto = protoEnumBridge(
  'SubscriptionStatus',
  SubscriptionStatus,
  ProtoSubscriptionStatus,
);

/** `BillingInterval` ⇄ `wayfare.billing.BillingInterval`. */
export const billingIntervalProto = protoEnumBridge(
  'BillingInterval',
  BillingInterval,
  ProtoBillingInterval,
);

/** `BillingEventStatus` ⇄ `wayfare.billing.BillingEventStatus`. */
export const billingEventStatusProto = protoEnumBridge(
  'BillingEventStatus',
  BillingEventStatus,
  ProtoBillingEventStatus,
);

/** `StripeEndpoint` ⇄ `wayfare.billing.StripeEndpoint`. */
export const stripeEndpointProto = protoEnumBridge(
  'StripeEndpoint',
  StripeEndpoint,
  ProtoStripeEndpoint,
);

/** `NarrationLanguageScope` ⇄ `wayfare.billing.NarrationLanguageScope`. */
export const narrationLanguageScopeProto = protoEnumBridge(
  'NarrationLanguageScope',
  NarrationLanguageScope,
  ProtoNarrationLanguageScope,
);

/** `AnalyticsLevel` ⇄ `wayfare.billing.AnalyticsLevel`. */
export const analyticsLevelProto = protoEnumBridge(
  'AnalyticsLevel',
  AnalyticsLevel,
  ProtoAnalyticsLevel,
);

/** Every bridge, so one spec can round-trip them all. Each new proto enum adds its line here. */
export const PROTO_ENUM_BRIDGES = [
  platformProto,
  sessionClientProto,
  legalDocumentProto,
  legalPartyProto,
  actionTokenPurposeProto,
  emailTemplateProto,
  emailDeliveryStatusProto,
  emailBounceTypeProto,
  ownerRegistrationStatusProto,
  placeKindProto,
  placeStatusProto,
  placeInactiveReasonProto,
  categoryAppliesToProto,
  mapPackStatusProto,
  replacementTypeProto,
  overrideStatusProto,
  audioStatusProto,
  translationSourceProto,
  uploadPurposeProto,
  menuCurrencyProto,
  contentTierProto,
  localizationTargetTypeProto,
  synthesisTriggerProto,
  synthesisJobStatusProto,
  synthesisStageProto,
  synthesisTaskStatusProto,
  onDemandStatusProto,
  subscriptionStatusProto,
  billingIntervalProto,
  billingEventStatusProto,
  stripeEndpointProto,
  narrationLanguageScopeProto,
  analyticsLevelProto,
] as const;
