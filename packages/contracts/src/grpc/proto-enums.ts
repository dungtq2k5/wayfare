import { SessionClient } from '../access/clients';
import {
  AudioStatus,
  CategoryAppliesTo,
  PlaceInactiveReason,
  PlaceKind,
  PlaceStatus,
  UploadPurpose,
} from '../catalog/enums';
import { ContentTier } from '../catalog/localization';
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
import {
  AudioStatus as ProtoAudioStatus,
  CategoryAppliesTo as ProtoCategoryAppliesTo,
  ContentTier as ProtoContentTier,
  MenuCurrency as ProtoMenuCurrency,
  PlaceInactiveReason as ProtoPlaceInactiveReason,
  PlaceKind as ProtoPlaceKind,
  PlaceStatus as ProtoPlaceStatus,
  TranslationSource as ProtoTranslationSource,
} from '../generated/wayfare/catalog/place_types.pb';
import { UploadPurpose as ProtoUploadPurpose } from '../generated/wayfare/catalog/upload.pb';
import { MenuCurrency } from '../money/display-price';
import { TranslationSource } from '../narration/enums';
import { ActionTokenPurpose, LegalDocument, Platform } from '../identity/enums';
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

/** `MenuCurrency` ⇄ `wayfare.catalog.MenuCurrency`. */
export const menuCurrencyProto = protoEnumBridge('MenuCurrency', MenuCurrency, ProtoMenuCurrency);

/** `ContentTier` ⇄ `wayfare.catalog.ContentTier`. */
export const contentTierProto = protoEnumBridge('ContentTier', ContentTier, ProtoContentTier);

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
  placeKindProto,
  placeStatusProto,
  placeInactiveReasonProto,
  categoryAppliesToProto,
  audioStatusProto,
  translationSourceProto,
  uploadPurposeProto,
  menuCurrencyProto,
  contentTierProto,
] as const;
