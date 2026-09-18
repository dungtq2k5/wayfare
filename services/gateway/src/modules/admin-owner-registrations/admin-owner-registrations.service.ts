import { Injectable } from '@nestjs/common';
import type { OwnerRegistrationAdmin, OwnerRegistrationAdminItem } from '@wayfare/contracts';
import type { AccountContext } from '@wayfare/nest-common';
import { Paged, toPageMetaOrThrow } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import {
  toListRegistrationsRequest,
  toOwnerRegistrationAdmin,
  toOwnerRegistrationAdminItem,
} from './admin-owner-registration.mapper';
import type {
  ApproveRegistrationDto,
  OwnerRegistrationQueueQueryDto,
  RejectRegistrationDto,
} from './dto/admin-owner-registration.dto';

/** `/admin/owner-registrations`, backed by `identity.OwnerReviewService`. */
@Injectable()
export class AdminOwnerRegistrationsService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async list(
    context: AccountContext,
    query: OwnerRegistrationQueueQueryDto,
  ): Promise<Paged<OwnerRegistrationAdminItem>> {
    const response = await this.identity.ownerReview.call(
      'listRegistrations',
      toListRegistrationsRequest(query),
      context,
    );
    const meta = toPageMetaOrThrow(response.page);
    return Paged.page(
      response.registrations.map(toOwnerRegistrationAdminItem),
      meta.page,
      meta.pageSize,
      meta.total,
    );
  }

  async get(context: AccountContext, registrationId: string): Promise<OwnerRegistrationAdmin> {
    const response = await this.identity.ownerReview.call(
      'getRegistration',
      { registrationId },
      context,
    );
    return toOwnerRegistrationAdmin(response.registration);
  }

  async reveal(context: AccountContext, registrationId: string): Promise<{ nationalId: string }> {
    const response = await this.identity.ownerReview.call(
      'revealNationalId',
      { registrationId },
      context,
    );
    return { nationalId: response.nationalId };
  }

  async approve(
    context: AccountContext,
    registrationId: string,
    body: ApproveRegistrationDto,
  ): Promise<{ registration: OwnerRegistrationAdmin }> {
    const response = await this.identity.ownerReview.call(
      'approveRegistration',
      {
        registrationId,
        ...(body.decisionNote === undefined ? {} : { decisionNote: body.decisionNote }),
        ...(body.internalNote === undefined ? {} : { internalNote: body.internalNote }),
      },
      context,
    );
    return { registration: toOwnerRegistrationAdmin(response.registration) };
  }

  async reject(
    context: AccountContext,
    registrationId: string,
    body: RejectRegistrationDto,
  ): Promise<{ registration: OwnerRegistrationAdmin }> {
    const response = await this.identity.ownerReview.call(
      'rejectRegistration',
      {
        registrationId,
        decisionNote: body.decisionNote,
        ...(body.internalNote === undefined ? {} : { internalNote: body.internalNote }),
      },
      context,
    );
    return { registration: toOwnerRegistrationAdmin(response.registration) };
  }
}
