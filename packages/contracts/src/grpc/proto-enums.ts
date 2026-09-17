import { SessionClient } from '../access/clients';
import { protoEnumBridge } from '../common/proto-enum-bridge';
import { SessionClient as ProtoSessionClient } from '../generated/wayfare/identity/auth.pb';
import { Platform as ProtoPlatform } from '../generated/wayfare/identity/device.pb';
import {
  LegalDocument as ProtoLegalDocument,
  LegalParty as ProtoLegalParty,
} from '../generated/wayfare/identity/user.pb';
import { LegalDocument, Platform } from '../identity/enums';
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

/** Every bridge, so one spec can round-trip them all. Each new proto enum adds its line here. */
export const PROTO_ENUM_BRIDGES = [
  platformProto,
  sessionClientProto,
  legalDocumentProto,
  legalPartyProto,
] as const;
