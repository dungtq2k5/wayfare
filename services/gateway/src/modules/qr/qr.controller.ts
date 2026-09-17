import { Controller, Get, Header, Param, Redirect, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { MAX_SEARCH_LENGTH } from '@wayfare/contracts';
import { Auth, Ctx, RateLimit, SkipClientHeader, SkipEnvelope } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { QrService } from './qr.service';

/**
 * `GET /q/:publicCode` — unprefixed and unversioned, so the printed URL never changes
 * (ADR 0057). A phone camera sends no client header. A redirect, so it is not in the OpenAPI
 * document; `no-store`, so every scan reaches the counter.
 */
@ApiExcludeController()
@Auth('PUBLIC')
@RateLimit('PUBLIC_READ')
@SkipClientHeader()
@SkipEnvelope()
@Controller({ path: 'q', version: VERSION_NEUTRAL })
export class QrController {
  constructor(private readonly qr: QrService) {}

  @Get(':publicCode')
  @Header('Cache-Control', 'no-store')
  @Redirect(undefined, 302)
  async resolve(
    @Ctx() context: RequestContext,
    @Param('publicCode') publicCode: string,
  ): Promise<{ url: string }> {
    return { url: await this.qr.resolve(context, publicCode.slice(0, MAX_SEARCH_LENGTH)) };
  }
}
