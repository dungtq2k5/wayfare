import { Controller, Get, Param, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { CLIENT_HEADER, MAX_SEARCH_LENGTH } from '@wayfare/contracts';
import { Auth, Ctx, RateLimit, SkipClientHeader, SkipEnvelope } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import type { Response } from 'express';
import { QrService } from './qr.service';

/**
 * `GET /q/:publicCode` — unprefixed and unversioned, so the printed URL never changes
 * (ADR 0057). A phone camera sends no client header and is redirected to the Place's link. The
 * app, which resolves the code itself, sends its usual headers and gets `204` after the count:
 * only the header's presence is read, since this route never validates it. `no-store` on both, so
 * every scan reaches the counter; a redirect, so it is not in the OpenAPI document.
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
  async resolve(
    @Ctx() context: RequestContext,
    @Param('publicCode') publicCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.qr.resolve(context, publicCode.slice(0, MAX_SEARCH_LENGTH));
    res.setHeader('Cache-Control', 'no-store');
    if (res.req.headers[CLIENT_HEADER] !== undefined) res.status(204).end();
    else res.redirect(302, url);
  }
}
