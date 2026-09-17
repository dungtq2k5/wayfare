import { Injectable } from '@nestjs/common';
import { SessionResponder } from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import type { Response } from 'express';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import type { ResetLinkResponseDto } from './dto/password-response.dto';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  LinkTokenDto,
  ResetPasswordDto,
} from './dto/password.dto';
import { toResetLinkResponseDto } from './password.mapper';

/** `/auth/password` routes, backed by `identity.PasswordService`. */
@Injectable()
export class PasswordService {
  constructor(
    private readonly identity: IdentityServiceGrpcClient,
    private readonly responder: SessionResponder,
  ) {}

  async forgot(context: RequestContext, body: ForgotPasswordDto): Promise<void> {
    await this.identity.passwords.call('requestPasswordReset', { email: body.email }, context);
  }

  async validate(context: RequestContext, body: LinkTokenDto): Promise<ResetLinkResponseDto> {
    return toResetLinkResponseDto(
      await this.identity.passwords.call('validateResetToken', { token: body.token }, context),
    );
  }

  /** Every session is gone after a reset, so this client's cookies go too. */
  async reset(context: RequestContext, body: ResetPasswordDto, res: Response): Promise<void> {
    await this.identity.passwords.call(
      'completePasswordReset',
      { token: body.token, newPassword: body.newPassword },
      context,
    );
    this.responder.clear(res);
  }

  async change(context: AccountContext, body: ChangePasswordDto): Promise<void> {
    await this.identity.passwords.call(
      'changePassword',
      { currentPassword: body.currentPassword, newPassword: body.newPassword },
      context,
    );
  }
}
