import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@wayfare/nest-common';
import { toRegisterDeviceRequest, toRegisterDeviceResponseDto } from './device.mapper';
import type { RegisterDeviceResponseDto } from './dto/device-response.dto';
import type { RegisterDeviceDto } from './dto/device.dto';
import { IdentityServiceGrpcClient } from './identity-service-grpc.client';

/** Device routes — a pass-through to identity, which is the layer doing its job. */
@Injectable()
export class DevicesService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async register(
    context: RequestContext,
    body: RegisterDeviceDto,
  ): Promise<RegisterDeviceResponseDto> {
    const response = await this.identity.registerDevice(toRegisterDeviceRequest(body), context);
    return toRegisterDeviceResponseDto(response);
  }
}
