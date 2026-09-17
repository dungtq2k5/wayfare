import { Injectable } from '@nestjs/common';
import { SessionResponder } from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import type { Response } from 'express';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import type { LinkTokenDto } from '../password/dto/password.dto';
import type { ChangeEmailDto } from './dto/email-change.dto';

/** `/auth/email` routes, backed by `identity.EmailChangeService`. */
@Injectable()
export class EmailChangeService {
  constructor(
    private readonly identity: IdentityServiceGrpcClient,
    private readonly responder: SessionResponder,
  ) {}

  async requestVerification(context: AccountContext): Promise<void> {
    await this.identity.emailChange.call('requestEmailVerification', {}, context);
  }

  async verify(context: RequestContext, body: LinkTokenDto): Promise<void> {
    await this.identity.emailChange.call('verifyEmail', { token: body.token }, context);
  }

  async requestChange(context: AccountContext, body: ChangeEmailDto): Promise<void> {
    await this.identity.emailChange.call(
      'requestEmailChange',
      { newEmail: body.newEmail, currentPassword: body.currentPassword },
      context,
    );
  }

  async confirmChange(context: RequestContext, body: LinkTokenDto): Promise<void> {
    await this.identity.emailChange.call('confirmEmailChange', { token: body.token }, context);
  }

  /** A revert signs every session out, so this client's cookies go too. */
  async revertChange(context: RequestContext, body: LinkTokenDto, res: Response): Promise<void> {
    await this.identity.emailChange.call('revertEmailChange', { token: body.token }, context);
    this.responder.clear(res);
  }
}
