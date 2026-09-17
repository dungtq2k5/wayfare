import { Platform } from '../identity/enums';
import { Platform as ProtoPlatform } from '../generated/wayfare/identity/device.pb';
import { protoEnumBridge } from '../common/proto-enum-bridge';

/** `Platform` ⇄ `wayfare.identity.Platform`. */
export const platformProto = protoEnumBridge('Platform', Platform, ProtoPlatform);

/** Every bridge, so one spec can round-trip them all. Each new proto enum adds its line here. */
export const PROTO_ENUM_BRIDGES = [platformProto] as const;
