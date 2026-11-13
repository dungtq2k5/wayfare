import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import type { CancelRecoveryDto, CompleteRecoveryDto } from './dto/account-recovery.dto';

/** `/account-recoveries`, backed by `identity.RecoveryService`. */
@Injectable()
export class AccountRecoveriesService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async cancel(
    context: RequestContext,
    recoveryId: string,
    body: CancelRecoveryDto,
  ): Promise<void> {
    await this.identity.recoveries.call(
      'cancelRecovery',
      { recoveryId, ...(body.token === undefined ? {} : { token: body.token }) },
      context,
    );
  }

  async complete(context: RequestContext, body: CompleteRecoveryDto): Promise<void> {
    await this.identity.recoveries.call(
      'completeRecovery',
      { token: body.token, newPassword: body.newPassword },
      context,
    );
  }
}
