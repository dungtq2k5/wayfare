import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { DevicesService } from './devices.service';

/** `wayfare.identity.DeviceService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.DeviceServiceControllerMethods()
export class DevicesGrpcController implements identityGrpc.DeviceServiceController {
  constructor(private readonly devices: DevicesService) {}

  registerDevice(
    request: identityGrpc.RegisterDeviceRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RegisterDeviceResponse> {
    return this.devices.registerDevice(request, unpackCallerContext(metadata));
  }

  exchangeDeviceToken(
    request: identityGrpc.ExchangeDeviceTokenRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ExchangeDeviceTokenResponse> {
    unpackCallerContext(metadata); // a caller without metadata is a bug, even here
    return this.devices.exchangeDeviceToken(request);
  }

  updateDevice(
    request: identityGrpc.UpdateDeviceRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.UpdateDeviceResponse> {
    return this.devices.updateDevice(request, unpackCallerContext(metadata));
  }

  forgetDevice(
    _request: identityGrpc.ForgetDeviceRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ForgetDeviceResponse> {
    return this.devices.forgetDevice(unpackCallerContext(metadata));
  }
}
