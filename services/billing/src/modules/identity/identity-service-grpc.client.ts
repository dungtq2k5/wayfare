import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { GrpcServiceCaller, SYSTEM_ORIGIN } from '@wayfare/nest-common';

/** Injection token for identity's gRPC connection. */
export const IDENTITY_GRPC = Symbol('IDENTITY_GRPC');

/**
 * identity as billing calls it (api-endpoints-plan §12.2): live, verified owner ids, for the
 * daily reconcile that opens any account the event stream's retention lost. Called with a system
 * context.
 */
@Injectable()
export class IdentityServiceGrpcClient implements OnModuleInit {
  readonly owners: GrpcServiceCaller<identityGrpc.OwnerServiceClient>;

  constructor(@Inject(IDENTITY_GRPC) grpc: ClientGrpc) {
    this.owners = new GrpcServiceCaller(grpc, identityGrpc.OWNER_SERVICE_NAME);
  }

  onModuleInit(): void {
    this.owners.init();
  }

  /** One page of live, verified owner ids. */
  async listVerifiedOwnerIds(
    page: identityGrpc.ListVerifiedOwnerIdsRequest['page'],
  ): Promise<identityGrpc.ListVerifiedOwnerIdsResponse> {
    return this.owners.call(
      'listVerifiedOwnerIds',
      { page },
      { kind: 'anonymous', origin: SYSTEM_ORIGIN },
    );
  }
}
