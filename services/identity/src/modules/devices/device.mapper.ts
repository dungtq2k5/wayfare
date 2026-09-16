import { status } from '@grpc/grpc-js';
import { Platform } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { rpcError } from '@wayfare/nest-common';

// ASK View `docs/archive/ref/grpc-mappers` to understand what's in my mind that we can optimize the grpc enum gap.
const FROM_PROTO_PLATFORM: Readonly<Partial<Record<identityGrpc.Platform, Platform>>> = {
  [identityGrpc.Platform.PLATFORM_IOS]: Platform.IOS,
  [identityGrpc.Platform.PLATFORM_ANDROID]: Platform.ANDROID,
  [identityGrpc.Platform.PLATFORM_WEB]: Platform.WEB,
};

/**
 * The domain `Platform` for a proto value. `UNSPECIFIED` — and `UNRECOGNIZED` from a newer
 * peer — is `INVALID_ARGUMENT`, never defaulted (conventions §6.3).
 */
export function fromProtoPlatform(value: identityGrpc.Platform): Platform {
  const platform = FROM_PROTO_PLATFORM[value];
  if (platform === undefined) {
    throw rpcError(status.INVALID_ARGUMENT, 'VALIDATION_FAILED', {
      issues: [{ path: '/platform', code: 'invalid_value' }],
    });
  }
  return platform;
}

/** The `RegisterDevice` response. */
export function toRegisterDeviceResponse(
  deviceId: string,
  deviceSecret: string,
): identityGrpc.RegisterDeviceResponse {
  return { deviceId, deviceSecret };
}
