import { SessionClient } from '../access/clients';
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
] as const;
