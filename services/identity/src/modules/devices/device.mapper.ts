import type { Platform } from '@wayfare/contracts';
import { platformProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { requireProtoEnum } from '@wayfare/nest-common';

/**
 * The domain `Platform` for a request field. `UNSPECIFIED` — and a value only a newer peer knows —
 * is `INVALID_ARGUMENT`, never defaulted (conventions §6.3).
 */
export function fromProtoPlatform(value: identityGrpc.Platform): Platform {
  return requireProtoEnum(platformProto, value, '/platform');
}

/** The `RegisterDevice` response. */
export function toRegisterDeviceResponse(
  deviceId: string,
  deviceSecret: string,
): identityGrpc.RegisterDeviceResponse {
  return { deviceId, deviceSecret };
}
