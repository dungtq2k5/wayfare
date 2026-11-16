import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  Auth,
  Ctx,
  NoStore,
  RateLimit,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { AccountRecoveriesService } from './account-recoveries.service';
import {
  AccountRecoveryIdParamDto,
  CancelRecoveryDto,
  CompleteRecoveryDto,
} from './dto/account-recovery.dto';

/**
 * `/account-recoveries` — the owner's own two routes (api-endpoints-plan §1.10). Both are public
 * and take a secret, so both answer the same `410` for a wrong, spent or expired token: an
 * attacker, signed in or not, learns nothing about whether a case exists.
 */
@ApiTags('account-recoveries')
@UsesUpstream()
@Controller('account-recoveries')
export class AccountRecoveriesController {
  constructor(private readonly recoveries: AccountRecoveriesService) {}

  @Post(':id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('PUBLIC')
  @RateLimit('AUTH')
  @NoStore()
  @ApiOperation({
    summary: "Stop a recovery: the case's own owner signed in, or anyone with the notice's token.",
  })
  @ApiEnvelope(null)
  @ApiErrors('TOKEN_EXPIRED')
  cancel(
    @Ctx() context: RequestContext,
    @Param() params: AccountRecoveryIdParamDto,
    @Body() body: CancelRecoveryDto,
  ): Promise<void> {
    return this.recoveries.cancel(context, params.id, body);
  }

  @Post('complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('PUBLIC')
  @RateLimit('AUTH')
  @NoStore()
  @ApiOperation({
    summary: 'Finish a recovery: the address moves, the password is set and every session ends.',
  })
  @ApiEnvelope(null)
  @ApiErrors('TOKEN_EXPIRED', 'EMAIL_TAKEN')
  complete(@Ctx() context: RequestContext, @Body() body: CompleteRecoveryDto): Promise<void> {
    return this.recoveries.complete(context, body);
  }
}
