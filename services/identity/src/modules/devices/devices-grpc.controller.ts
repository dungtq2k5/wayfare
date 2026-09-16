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
}
