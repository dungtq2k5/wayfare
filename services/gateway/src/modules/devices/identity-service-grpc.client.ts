import { Inject, Injectable } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { BaseGrpcClient } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';

/** Injection token for identity's gRPC connection. */
export const IDENTITY_GRPC = Symbol('IDENTITY_GRPC');

/** `wayfare.identity.DeviceService` as the gateway calls it. Returns proto types only. */
@Injectable()
export class IdentityServiceGrpcClient extends BaseGrpcClient<identityGrpc.DeviceServiceClient> {
  constructor(@Inject(IDENTITY_GRPC) grpc: ClientGrpc) {
    super(grpc, identityGrpc.DEVICE_SERVICE_NAME);
  }

  registerDevice(
    request: identityGrpc.RegisterDeviceRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RegisterDeviceResponse> {
    return this.call('registerDevice', request, context);
  }
}
