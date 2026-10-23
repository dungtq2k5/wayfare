import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Auth, Ctx, NoStore, RateLimit, UsesUpstream } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { DevService } from './dev.service';
import { FakeGoogleTokenDto } from './dto/dev.dto';
import { FakeGoogleTokenResponseDto } from './dto/fake-google-token-response.dto';

/**
 * `/dev` — answers only with `GOOGLE_ISSUER=fake`, which production refuses (ADR 0063), and is kept
 * out of the published API document.
 */
@ApiExcludeController()
@UsesUpstream()
@Controller('dev')
export class DevController {
  constructor(private readonly dev: DevService) {}

  @Post('google-token')
  @HttpCode(HttpStatus.OK)
  @Auth('PUBLIC')
  @RateLimit('PUBLIC_READ')
  @NoStore()
  @ZodSerializerDto(FakeGoogleTokenResponseDto)
  fakeGoogleToken(
    @Ctx() context: RequestContext,
    @Body() body: FakeGoogleTokenDto,
  ): Promise<{ idToken: string }> {
    return this.dev.fakeGoogleToken(context, body);
  }
}
