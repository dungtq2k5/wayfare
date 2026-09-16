import { Platform } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import type { RegisterDeviceResponseDto } from './dto/device-response.dto';
import type { RegisterDeviceDto } from './dto/device.dto';

const TO_PROTO_PLATFORM: Readonly<Record<Platform, identityGrpc.Platform>> = {
  [Platform.IOS]: identityGrpc.Platform.PLATFORM_IOS,
  [Platform.ANDROID]: identityGrpc.Platform.PLATFORM_ANDROID,
  [Platform.WEB]: identityGrpc.Platform.PLATFORM_WEB,
};

/** The `RegisterDevice` request for a validated body. */
export function toRegisterDeviceRequest(
  body: RegisterDeviceDto,
): identityGrpc.RegisterDeviceRequest {
  return {
    platform: TO_PROTO_PLATFORM[body.platform],
    appVersion: body.appVersion,
    ...(body.osVersion === undefined ? {} : { osVersion: body.osVersion }),
    contentLocale: body.contentLocale,
    privacyPolicyVersion: body.privacyPolicyVersion,
  };
}

/** The response DTO, field by field — never a spread of the proto. */
export function toRegisterDeviceResponseDto(
  response: identityGrpc.RegisterDeviceResponse,
): RegisterDeviceResponseDto {
  return { deviceId: response.deviceId, deviceSecret: response.deviceSecret };
}
