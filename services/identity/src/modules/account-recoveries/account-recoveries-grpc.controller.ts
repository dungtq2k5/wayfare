import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { AccountRecoveriesService } from './account-recoveries.service';

/** `wayfare.identity.RecoveryService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.RecoveryServiceControllerMethods()
export class AccountRecoveriesGrpcController implements identityGrpc.RecoveryServiceController {
  constructor(private readonly recoveries: AccountRecoveriesService) {}

  cancelRecovery(
    request: identityGrpc.CancelRecoveryRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.CancelRecoveryResponse> {
    return this.recoveries.cancelRecovery(request, unpackCallerContext(metadata));
  }

  completeRecovery(
    request: identityGrpc.CompleteRecoveryRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.CompleteRecoveryResponse> {
    return this.recoveries.completeRecovery(request, unpackCallerContext(metadata));
  }
}
