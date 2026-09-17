import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { UsersService } from './users.service';

/** `wayfare.identity.UserService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.UserServiceControllerMethods()
export class UsersGrpcController implements identityGrpc.UserServiceController {
  constructor(private readonly users: UsersService) {}

  getMe(
    _request: identityGrpc.GetMeRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.GetMeResponse> {
    return this.users.getMe(unpackCallerContext(metadata));
  }

  updateMe(
    request: identityGrpc.UpdateMeRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.UpdateMeResponse> {
    return this.users.updateMe(request, unpackCallerContext(metadata));
  }

  listLegalAcceptances(
    _request: identityGrpc.ListLegalAcceptancesRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ListLegalAcceptancesResponse> {
    return this.users.listLegalAcceptances(unpackCallerContext(metadata));
  }

  recordLegalAcceptance(
    request: identityGrpc.RecordLegalAcceptanceRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.RecordLegalAcceptanceResponse> {
    return this.users.recordLegalAcceptance(request, unpackCallerContext(metadata));
  }
}
