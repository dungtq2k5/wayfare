import type { Platform } from '@wayfare/contracts';
import { platformProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { requireProtoEnum } from '@wayfare/nest-common';

/** The device columns a response shows. */
export interface DeviceRow {
  readonly id: string;
  readonly appVersion: string;
  readonly osVersion: string | null;
  readonly contentLocale: string;
}

/**
 * The domain `Platform` for a request field. `UNSPECIFIED` — and a value only a newer peer knows —
 * is `INVALID_ARGUMENT`, never defaulted (conventions §6.3).
 */
export function fromProtoPlatform(value: identityGrpc.Platform): Platform {
  return requireProtoEnum(platformProto, value, '/platform');
}

/** A device as `UpdateDevice` returns it; the push token is never echoed. */
export function toDeviceView(row: DeviceRow): identityGrpc.DeviceView {
  return {
    deviceId: row.id,
    appVersion: row.appVersion,
    ...(row.osVersion === null ? {} : { osVersion: row.osVersion }),
    contentLocale: row.contentLocale,
  };
}
