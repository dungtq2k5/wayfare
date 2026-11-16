import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { AccountSecurityService } from './account-security.service';

/** `wayfare.identity.AccountSecurityService` — internal, called with a system context. */
@Controller()
@identityGrpc.AccountSecurityServiceControllerMethods()
export class AccountSecurityGrpcController
  implements identityGrpc.AccountSecurityServiceController
{
  constructor(private readonly security: AccountSecurityService) {}

  getSecurityState(
    request: identityGrpc.GetSecurityStateRequest,
  ): Promise<identityGrpc.GetSecurityStateResponse> {
    return this.security.getSecurityState(request);
  }
}
