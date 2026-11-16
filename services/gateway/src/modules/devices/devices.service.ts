import { Injectable } from '@nestjs/common';
import { LegalParty } from '@wayfare/contracts';
import type { RequestContext } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import {
  toDeviceResponseDto,
  toDeviceTokenResponseDto,
  toLegalAcceptanceResponseDto,
  toRecordLegalAcceptanceRequest,
  toRegisterDeviceRequest,
  toRegisterDeviceResponseDto,
  toUpdateDeviceRequest,
} from './device.mapper';
import type {
  DeviceResponseDto,
  DeviceTokenResponseDto,
  LegalAcceptanceResponseDto,
  RegisterDeviceResponseDto,
} from './dto/device-response.dto';
import type {
  ExchangeDeviceTokenDto,
  RecordLegalAcceptanceDto,
  RegisterDeviceDto,
  UpdateDeviceDto,
} from './dto/device.dto';

/** Device routes — a pass-through to identity, which is the layer doing its job. */
@Injectable()
export class DevicesService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async register(
    context: RequestContext,
    body: RegisterDeviceDto,
  ): Promise<RegisterDeviceResponseDto> {
    const response = await this.identity.devices.call(
      'registerDevice',
      toRegisterDeviceRequest(body),
      context,
    );
    return toRegisterDeviceResponseDto(response);
  }

  async exchange(
    context: RequestContext,
    body: ExchangeDeviceTokenDto,
  ): Promise<DeviceTokenResponseDto> {
    const response = await this.identity.devices.call(
      'exchangeDeviceToken',
      { deviceId: body.deviceId, deviceSecret: body.deviceSecret },
      context,
    );
    return toDeviceTokenResponseDto(response);
  }

  async update(context: RequestContext, body: UpdateDeviceDto): Promise<DeviceResponseDto> {
    const response = await this.identity.devices.call(
      'updateDevice',
      toUpdateDeviceRequest(body),
      context,
    );
    return toDeviceResponseDto(response.device);
  }

  async forget(context: RequestContext): Promise<void> {
    await this.identity.devices.call('forgetDevice', {}, context);
  }

  async recordAcceptance(
    context: RequestContext,
    body: RecordLegalAcceptanceDto,
  ): Promise<LegalAcceptanceResponseDto> {
    const response = await this.identity.users.call(
      'recordLegalAcceptance',
      toRecordLegalAcceptanceRequest(body, LegalParty.DEVICE),
      context,
    );
    return toLegalAcceptanceResponseDto(response.acceptance);
  }
}
