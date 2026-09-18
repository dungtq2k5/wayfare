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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnDemandStatus } from '@wayfare/contracts';
import {
  ApiEnvelope,
  ApiErrors,
  Auth,
  Ctx,
  PrivateCache,
  RateLimit,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import type { Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  NarrationStatusResponseDto,
  OnDemandAnsweredResponseDto,
  OnDemandPendingResponseDto,
  OnDemandResponseDto,
} from './dto/narration-response.dto';
import type { OnDemandAnswer } from './dto/narration-response.dto';
import { NarrationPlaceParamDto, NarrationStatusQueryDto, OnDemandDto } from './dto/narration.dto';
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
