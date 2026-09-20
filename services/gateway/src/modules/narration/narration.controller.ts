import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnDemandStatus } from '@wayfare/contracts';
import type { HotsetResponse, PrefetchResponse } from '@wayfare/contracts';
import {
  ApiEnvelope,
  ApiErrors,
  Auth,
  Ctx,
  NoStore,
  PrivateCache,
  RateLimit,
  SkipEnvelope,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import type { Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  HotsetResponseDto,
  NarrationStatusResponseDto,
  OnDemandAnsweredResponseDto,
  OnDemandPendingResponseDto,
  OnDemandResponseDto,
  PrefetchResponseDto,
} from './dto/narration-response.dto';
import type { OnDemandAnswer } from './dto/narration-response.dto';
import {
  HotsetDto,
  NarrationPlaceParamDto,
  NarrationStatusQueryDto,
  OnDemandDto,
  PrefetchDto,
  StreamQueryDto,
} from './dto/narration.dto';
import { NarrationService } from './narration.service';

/** `/narration` — on-demand narration for tourist devices (api-endpoints-plan §4.1). */
@ApiTags('narration')
@UsesUpstream()
@Controller('narration')
export class NarrationController {
  constructor(private readonly narration: NarrationService) {}

  @Post('on-demand')
  @HttpCode(HttpStatus.OK)
  @Auth('DEVICE')
  @RateLimit('NARRATION_ON_DEMAND')
  @ApiOperation({
    summary:
      'Audio for a language: 200 when ready or not served, 202 with the job while it is made.',
  })
  @ApiEnvelope(OnDemandAnsweredResponseDto, {
    alternatives: [
      { status: HttpStatus.ACCEPTED, model: OnDemandPendingResponseDto, description: 'Pending' },
    ],
  })
  @ApiErrors('RESOURCE_NOT_FOUND', 'LANGUAGE_NOT_ENTITLED', 'ENTITLEMENTS_UNAVAILABLE')
  @ZodSerializerDto(OnDemandResponseDto)
  async onDemand(
    @Ctx() context: RequestContext,
    @Body() body: OnDemandDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OnDemandAnswer> {
    const answer = await this.narration.onDemand(context, body);
    if (answer.status === OnDemandStatus.PENDING) res.status(HttpStatus.ACCEPTED);
    return answer;
  }

  @Post('hotset')
  @HttpCode(HttpStatus.OK)
  @Auth('DEVICE')
  @RateLimit('NARRATION_ON_DEMAND')
  @NoStore()
  @ApiOperation({
    summary: 'A language switch: the nearest Places, warmed; the switch waits for a few of them.',
  })
  @ApiEnvelope(HotsetResponseDto)
  @ZodSerializerDto(HotsetResponseDto)
  hotset(@Ctx() context: RequestContext, @Body() body: HotsetDto): Promise<HotsetResponse> {
    return this.narration.hotset(context, body);
  }

  @Post('prefetch')
  @HttpCode(HttpStatus.ACCEPTED)
  @Auth('DEVICE')
  @RateLimit('NARRATION_ON_DEMAND')
  @NoStore()
  @ApiOperation({
    summary: 'Warm the Places ahead of the walker, behind everything a tourist taps.',
  })
  @ApiEnvelope(PrefetchResponseDto, { status: HttpStatus.ACCEPTED })
  @ZodSerializerDto(PrefetchResponseDto)
  prefetch(@Ctx() context: RequestContext, @Body() body: PrefetchDto): Promise<PrefetchResponse> {
    return this.narration.prefetch(context, body);
  }

  @Get('tts/stream')
  @Auth('DEVICE')
  @RateLimit('NARRATION_ON_DEMAND')
  @NoStore()
  @SkipEnvelope()
  // No static `Content-Type`: the `StreamableFile` carries `audio/mpeg` when there are bytes, and
  // a refusal stays an ordinary JSON envelope (api-endpoints-plan §4.1).
  @ApiOperation({
    summary: 'Audio tier 2: made now if it does not exist, and stored so the next tap is tier 1.',
  })
  @ApiEnvelope(null, { status: 200, mediaType: 'audio/mpeg' })
  @ApiErrors('RESOURCE_NOT_FOUND', 'INVALID_STATE', 'LANGUAGE_NOT_ENTITLED', 'UPSTREAM_UNAVAILABLE')
  stream(@Ctx() context: RequestContext, @Query() query: StreamQueryDto): Promise<StreamableFile> {
    return this.narration.stream(context, query);
  }

  @Get('places/:placeId/status')
  @Auth('DEVICE')
  @PrivateCache(2)
  @ApiOperation({ summary: "A Place's text and audio readiness in one language." })
  @ApiEnvelope(NarrationStatusResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(NarrationStatusResponseDto)
  status(
    @Ctx() context: RequestContext,
    @Param() params: NarrationPlaceParamDto,
    @Query() query: NarrationStatusQueryDto,
  ): Promise<NarrationStatusResponseDto> {
    return this.narration.status(context, params.placeId, query.lang);
  }
}
