import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { LegalParty } from '@wayfare/contracts';
import { SessionResponder, WithMeta } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { toBillingSummary } from '../billing/billing.mapper';
import { BillingServiceGrpcClient } from '../billing/billing-service-grpc.client';
import {
  toLegalAcceptanceResponseDto,
  toRecordLegalAcceptanceRequest,
} from '../devices/device.mapper';
import type { LegalAcceptanceResponseDto } from '../devices/dto/device-response.dto';
import type { RecordLegalAcceptanceDto } from '../devices/dto/device.dto';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import type { LegalAcceptanceStatusResponseDto } from './dto/legal-acceptance-response.dto';
import type { MeResponseDto, UpdateMeResponseDto } from './dto/user-response.dto';
import type { EraseMeDto, UpdateMeDto } from './dto/user.dto';
import {
  toLegalAcceptanceStatusResponseDto,
  toMeResponseDto,
  toUpdateMeRequest,
  toUserResponseDto,
} from './user.mapper';

/** `/users/me` routes, backed by `identity.UserService`. */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly identity: IdentityServiceGrpcClient,
    private readonly billing: BillingServiceGrpcClient,
    private readonly responder: SessionResponder,
  ) {}

  /**
   * The console's bootstrap: identity's account, and for an owner billing's summary. billing is the
   * secondary service: when it cannot answer, the summary is `null` and `meta.degraded` says so
   * (api-endpoints-plan §12.1).
   */
  async me(context: AccountContext): Promise<MeResponseDto | WithMeta<MeResponseDto>> {
    const me = toMeResponseDto(await this.identity.users.call('getMe', {}, context));
    if (!me.ownerVerified || me.owner === null) return me;
    try {
      const summary = await this.billing.billing.call(
        'getBillingSummary',
        { ownerUserId: context.userId },
        context,
      );
      return { ...me, owner: { ...me.owner, billingSummary: toBillingSummary(summary) } };
    } catch (error) {
      this.logger.warn(
        { kind: error instanceof Error ? error.name : 'unknown' },
        'billing summary unavailable; /users/me degraded',
      );
      return WithMeta.of(me, { degraded: ['billing'] });
    }
  }

  /**
   * Erasure (api-endpoints-plan §1.3). The account is gone on success, so this client's cookies go
   * with it; a refusal leaves them, as the session still stands.
   */
  async erase(context: AccountContext, body: EraseMeDto, res: Response): Promise<void> {
    await this.identity.users.call('eraseMe', { currentPassword: body.currentPassword }, context);
    this.responder.clear(res);
  }

  async update(context: AccountContext, body: UpdateMeDto): Promise<UpdateMeResponseDto> {
    const response = await this.identity.users.call('updateMe', toUpdateMeRequest(body), context);
    return { user: toUserResponseDto(response.user) };
  }

  async acceptances(context: AccountContext): Promise<LegalAcceptanceStatusResponseDto[]> {
    const response = await this.identity.users.call('listLegalAcceptances', {}, context);
    return response.acceptances.map(toLegalAcceptanceStatusResponseDto);
  }

  async recordAcceptance(
    context: AccountContext,
    body: RecordLegalAcceptanceDto,
  ): Promise<LegalAcceptanceResponseDto> {
    const response = await this.identity.users.call(
      'recordLegalAcceptance',
      toRecordLegalAcceptanceRequest(body, LegalParty.USER),
      context,
    );
    return toLegalAcceptanceResponseDto(response.acceptance);
  }
}
