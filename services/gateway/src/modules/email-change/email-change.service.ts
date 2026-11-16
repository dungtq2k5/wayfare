import { Injectable } from '@nestjs/common';
import { SessionResponder } from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import type { Response } from 'express';
import type { WayfareClient } from '@wayfare/contracts';
import { toSessionClient } from '../auth/session.mapper';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import type { LinkAnswerResponseDto } from './dto/link-answer-response.dto';
import type { LinkTokenDto } from '../password/dto/password.dto';
import type { ChangeEmailDto } from './dto/email-change.dto';

/** `/auth/email` routes, backed by `identity.EmailChangeService`. */
@Injectable()
export class EmailChangeService {
  constructor(
    private readonly identity: IdentityServiceGrpcClient,
    private readonly responder: SessionResponder,
  ) {}

  /** A console request's link opens the console (api-endpoints-plan §1.2). */
  async requestVerification(context: AccountContext, client: WayfareClient): Promise<void> {
    await this.identity.emailChange.call(
      'requestEmailVerification',
      { client: toSessionClient(client) },
      context,
    );
  }

  async verify(context: RequestContext, body: LinkTokenDto): Promise<LinkAnswerResponseDto> {
    return toLinkAnswer(
      await this.identity.emailChange.call('verifyEmail', { token: body.token }, context),
    );
  }

  async requestChange(context: AccountContext, body: ChangeEmailDto): Promise<void> {
    await this.identity.emailChange.call(
      'requestEmailChange',
      {
        newEmail: body.newEmail,
        currentPassword: body.currentPassword ?? '',
        confirmation: body.confirmation ?? '',
      },
      context,
    );
  }

  async confirmChange(context: RequestContext, body: LinkTokenDto): Promise<LinkAnswerResponseDto> {
    return toLinkAnswer(
      await this.identity.emailChange.call('confirmEmailChange', { token: body.token }, context),
    );
  }

  /** A revert signs every session out, so this client's cookies go too. */
  async revertChange(
    context: RequestContext,
    body: LinkTokenDto,
    res: Response,
  ): Promise<LinkAnswerResponseDto> {
    const answer = await this.identity.emailChange.call(
      'revertEmailChange',
      { token: body.token },
      context,
    );
    this.responder.clear(res);
    return toLinkAnswer(answer);
  }
}

/** A link's answer as the app reads it: the address masked, and whether it is the caller's. */
function toLinkAnswer(answer: {
  readonly emailMasked: string;
  readonly sameAccount: boolean;
}): LinkAnswerResponseDto {
  return { emailMasked: answer.emailMasked, sameAccount: answer.sameAccount };
}
