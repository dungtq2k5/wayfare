import { platformProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import type { RegisterDeviceResponseDto } from './dto/device-response.dto';
import type { RegisterDeviceDto } from './dto/device.dto';

/** The `RegisterDevice` request for a validated body. */
export function toRegisterDeviceRequest(
  body: RegisterDeviceDto,
): identityGrpc.RegisterDeviceRequest {
  return {
    platform: platformProto.toProto(body.platform),
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
