import { Injectable } from '@nestjs/common';
import type { OwnerRegistration } from '@wayfare/contracts';
import type { AccountContext } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import type { SubmitRegistrationDto } from './dto/owner-registration.dto';
import { toOwnerRegistration, toSubmitRegistrationRequest } from './owner-registration.mapper';

/** `/owner/registration`, backed by `identity.OwnerService`. */
@Injectable()
export class OwnerRegistrationService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async submit(
    context: AccountContext,
    body: SubmitRegistrationDto,
  ): Promise<{ registration: OwnerRegistration }> {
    const response = await this.identity.owner.call(
      'submitRegistration',
      toSubmitRegistrationRequest(body),
      context,
    );
    return { registration: toOwnerRegistration(response.registration) };
  }

  async listMine(context: AccountContext): Promise<OwnerRegistration[]> {
    const response = await this.identity.owner.call('listMyRegistrations', {}, context);
    return response.registrations.map(toOwnerRegistration);
  }

  async withdraw(
    context: AccountContext,
    registrationId: string,
  ): Promise<{ registration: OwnerRegistration }> {
    const response = await this.identity.owner.call(
      'withdrawRegistration',
      { registrationId },
      context,
    );
    return { registration: toOwnerRegistration(response.registration) };
  }
}
