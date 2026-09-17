import { Injectable } from '@nestjs/common';
import { LegalParty } from '@wayfare/contracts';
import type { AccountContext } from '@wayfare/nest-common';
import {
  toLegalAcceptanceResponseDto,
  toRecordLegalAcceptanceRequest,
} from '../devices/device.mapper';
import type { LegalAcceptanceResponseDto } from '../devices/dto/device-response.dto';
import type { RecordLegalAcceptanceDto } from '../devices/dto/device.dto';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import type { LegalAcceptanceStatusResponseDto } from './dto/legal-acceptance-response.dto';
import type { MeResponseDto, UpdateMeResponseDto } from './dto/user-response.dto';
import type { UpdateMeDto } from './dto/user.dto';
import {
  toLegalAcceptanceStatusResponseDto,
  toMeResponseDto,
  toUpdateMeRequest,
  toUserResponseDto,
} from './user.mapper';

/** `/users/me` routes, backed by `identity.UserService`. */
@Injectable()
export class UsersService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async me(context: AccountContext): Promise<MeResponseDto> {
    return toMeResponseDto(await this.identity.users.call('getMe', {}, context));
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
