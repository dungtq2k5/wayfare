import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { GrpcServiceCaller } from '@wayfare/nest-common';

/** Injection token for identity's gRPC connection. */
export const IDENTITY_GRPC = Symbol('IDENTITY_GRPC');

/** identity as catalog calls it (api-endpoints-plan §12.2): one caller per stub, proto types only. */
@Injectable()
export class IdentityServiceGrpcClient implements OnModuleInit {
  readonly owners: GrpcServiceCaller<identityGrpc.OwnerServiceClient>;

  constructor(@Inject(IDENTITY_GRPC) grpc: ClientGrpc) {
    this.owners = new GrpcServiceCaller(grpc, identityGrpc.OWNER_SERVICE_NAME);
  }

  onModuleInit(): void {
    this.owners.init();
  }
}
