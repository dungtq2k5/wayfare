import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { AdminRecoveriesService } from './admin-recoveries.service';

/** `wayfare.identity.RecoveryAdminService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.RecoveryAdminServiceControllerMethods()
export class AdminRecoveriesGrpcController implements identityGrpc.RecoveryAdminServiceController {
  constructor(private readonly recoveries: AdminRecoveriesService) {}

  openRecovery(
    request: identityGrpc.OpenRecoveryRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.OpenRecoveryResponse> {
    return this.recoveries.openRecovery(request, unpackCallerContext(metadata));
  }

  listRecoveries(
    request: identityGrpc.ListRecoveriesRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ListRecoveriesResponse> {
    return this.recoveries.listRecoveries(request, unpackCallerContext(metadata));
  }

  approveRecovery(
    request: identityGrpc.ApproveRecoveryRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ApproveRecoveryResponse> {
    return this.recoveries.approveRecovery(request, unpackCallerContext(metadata));
  }

  rejectRecovery(
    request: identityGrpc.RejectRecoveryRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RejectRecoveryResponse> {
    return this.recoveries.rejectRecovery(request, unpackCallerContext(metadata));
  }
}
