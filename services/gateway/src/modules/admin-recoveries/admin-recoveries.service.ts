import { Injectable } from '@nestjs/common';
import { recoveryEvidenceCodeProto } from '@wayfare/contracts/grpc';
import type { Recovery } from '@wayfare/contracts';
import { Paged, toPageMetaOrThrow } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import { toListRecoveriesRequest, toRecovery } from './admin-recovery.mapper';
import type {
  OpenRecoveryDto,
  RecoveryQueryDto,
  RejectRecoveryDto,
} from './dto/admin-recovery.dto';

/** `/admin/…-recoveries`, backed by `identity.RecoveryAdminService`. */
@Injectable()
export class AdminRecoveriesService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async open(
    context: AccountContext,
    userId: string,
    body: OpenRecoveryDto,
  ): Promise<{ recovery: Recovery }> {
    const response = await this.identity.adminRecoveries.call(
      'openRecovery',
      {
        userId,
        requestedEmail: body.requestedEmail,
        evidenceCodes: body.evidenceCodes.map((code) => recoveryEvidenceCodeProto.toProto(code)),
        supportReference: body.supportReference,
      },
      context,
    );
    return { recovery: toRecovery(response.recovery) };
  }

  async list(context: AccountContext, query: RecoveryQueryDto): Promise<Paged<Recovery>> {
    const response = await this.identity.adminRecoveries.call(
      'listRecoveries',
      toListRecoveriesRequest(query),
      context,
    );
    const meta = toPageMetaOrThrow(response.page);
    return Paged.page(
      response.recoveries.map((row) => toRecovery(row)),
      meta.page,
      meta.pageSize,
      meta.total,
    );
  }

  async approve(context: AccountContext, recoveryId: string): Promise<{ recovery: Recovery }> {
    const response = await this.identity.adminRecoveries.call(
      'approveRecovery',
      { recoveryId },
      context,
    );
    return { recovery: toRecovery(response.recovery) };
  }

  async reject(
    context: AccountContext,
    recoveryId: string,
    body: RejectRecoveryDto,
  ): Promise<{ recovery: Recovery }> {
    const response = await this.identity.adminRecoveries.call(
      'rejectRecovery',
      { recoveryId, decisionNote: body.decisionNote },
      context,
    );
    return { recovery: toRecovery(response.recovery) };
  }
}
