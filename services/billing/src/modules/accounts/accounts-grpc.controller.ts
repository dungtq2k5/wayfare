import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { AccountsService } from './accounts.service';

/** `wayfare.billing.AccountAdminService` — unpack the caller, delegate once. */
@Controller()
@billingGrpc.AccountAdminServiceControllerMethods()
export class AccountsGrpcController implements billingGrpc.AccountAdminServiceController {
  constructor(private readonly accounts: AccountsService) {}

  listAccounts(
    request: billingGrpc.ListAccountsRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.ListAccountsResponse> {
    return this.accounts.listAccounts(request, unpackCallerContext(metadata));
  }

  getAccount(
    request: billingGrpc.GetAccountRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.GetAccountResponse> {
    return this.accounts.getAccount(request, unpackCallerContext(metadata));
  }

  overrideEntitlements(
    request: billingGrpc.OverrideEntitlementsRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.OverrideEntitlementsResponse> {
    return this.accounts.overrideEntitlements(request, unpackCallerContext(metadata));
  }

  unpinEntitlements(
    request: billingGrpc.UnpinEntitlementsRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.UnpinEntitlementsResponse> {
    return this.accounts.unpinEntitlements(request, unpackCallerContext(metadata));
  }
}
