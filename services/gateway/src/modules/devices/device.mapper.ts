import { legalDocumentProto, legalPartyProto, platformProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { fromProtoTimestamp } from '@wayfare/nest-common';
import type {
  DeviceResponseDto,
  DeviceTokenResponseDto,
  LegalAcceptanceResponseDto,
  RegisterDeviceResponseDto,
} from './dto/device-response.dto';
import type {
  RecordLegalAcceptanceDto,
  RegisterDeviceDto,
  UpdateDeviceDto,
} from './dto/device.dto';

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
  return {
    deviceId: response.deviceId,
    deviceSecret: response.deviceSecret,
    accessToken: response.accessToken,
    expiresIn: response.expiresIn,
  };
}

/** A device token response. */
export function toDeviceTokenResponseDto(
  response: identityGrpc.ExchangeDeviceTokenResponse,
): DeviceTokenResponseDto {
  return { accessToken: response.accessToken, expiresIn: response.expiresIn };
}

/** The `UpdateDevice` request: only the fields the body carries. */
export function toUpdateDeviceRequest(body: UpdateDeviceDto): identityGrpc.UpdateDeviceRequest {
  return {
    ...(body.appVersion === undefined ? {} : { appVersion: body.appVersion }),
    ...(body.osVersion === undefined ? {} : { osVersion: body.osVersion }),
    ...(body.contentLocale === undefined ? {} : { contentLocale: body.contentLocale }),
    ...(body.pushToken === undefined ? {} : { pushToken: body.pushToken }),
  };
}

/** The device view; an absent optional becomes `null` (conventions §6.3). */
export function toDeviceResponseDto(view: identityGrpc.DeviceView | undefined): DeviceResponseDto {
  if (view === undefined) throw new Error('UpdateDevice answered without a device');
  return {
    deviceId: view.deviceId,
    appVersion: view.appVersion,
    osVersion: view.osVersion ?? null,
    contentLocale: view.contentLocale,
  };
}

/** A `RecordLegalAcceptance` request for a party. */
export function toRecordLegalAcceptanceRequest(
  body: RecordLegalAcceptanceDto,
  party: Parameters<typeof legalPartyProto.toProto>[0],
): identityGrpc.RecordLegalAcceptanceRequest {
  return {
    party: legalPartyProto.toProto(party),
    document: legalDocumentProto.toProto(body.document),
    version: body.version,
  };
}

/**
 * A legal acceptance. The enums were written by this build's identity; one it cannot read is a
 * peer ahead of us, which is a server fault, not a client one.
 */
export function toLegalAcceptanceResponseDto(
  acceptance: identityGrpc.LegalAcceptance | undefined,
): LegalAcceptanceResponseDto {
  if (acceptance === undefined) throw new Error('A legal acceptance is missing from the response');
  const party = legalPartyProto.fromProto(acceptance.party);
  const document = legalDocumentProto.fromProto(acceptance.document);
  if (party === null || document === null)
    throw new Error('A legal acceptance carries an unknown enum value');
  return {
    party,
    document,
    version: acceptance.version,
    acceptedAt: fromProtoTimestamp(acceptance.acceptedAt, 'acceptedAt').toISOString(),
  };
}
