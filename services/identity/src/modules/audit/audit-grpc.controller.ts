import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { AuditService } from './audit.service';

/** `wayfare.identity.AuditService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.AuditServiceControllerMethods()
export class AuditGrpcController implements identityGrpc.AuditServiceController {
  constructor(private readonly audit: AuditService) {}

  listAuditLogs(
    request: identityGrpc.ListAuditLogsRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ListAuditLogsResponse> {
    return this.audit.listAuditLogs(request, unpackCallerContext(metadata));
  }

  listAuditActions(
    _request: identityGrpc.ListAuditActionsRequest,
    metadata?: Metadata,
  ): identityGrpc.ListAuditActionsResponse {
    return this.audit.listAuditActions(unpackCallerContext(metadata));
  }
}
