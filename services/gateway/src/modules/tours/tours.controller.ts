import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, Auth, Ctx, RateLimit, UsesUpstream } from '@wayfare/nest-common';
import type { Paged, RequestContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { TourDetailResponseDto, TourSummaryResponseDto } from './dto/tour-response.dto';
import {
  TourCodeParamDto,
  TourIdParamDto,
  TourLanguageQueryDto,
  TourListQueryDto,
} from './dto/tour.dto';
import { ToursService } from './tours.service';

/**
 * `/tours` — an area's tours for tourists (api-endpoints-plan §2.2). A tour's page also answers
 * without a token, for the web's server-rendered `/t/` page, as a Place's does.
 */
@ApiTags('tours')
@UsesUpstream()
@Controller('tours')
export class ToursController {
  constructor(private readonly tours: ToursService) {}

  @Get()
  @Auth('DEVICE')
  @ApiOperation({ summary: "An area's tours with at least two live stops, cursor style." })
  @ApiEnvelope(TourSummaryResponseDto, { list: 'cursor' })
  @ApiErrors('VALIDATION_FAILED')
  @ZodSerializerDto(TourSummaryResponseDto)
  list(
    @Ctx() context: RequestContext,
    @Query() query: TourListQueryDto,
  ): Promise<Paged<TourSummaryResponseDto>> {
    return this.tours.list(context, query);
  }

  @Get('by-code/:publicCode')
  @Auth('PUBLIC')
  @RateLimit('LINK_READ')
  @ApiOperation({ summary: 'A tour by its printed code, after a link or a sticker.' })
  @ApiEnvelope(TourDetailResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'TOUR_UNAVAILABLE')
  @ZodSerializerDto(TourDetailResponseDto)
  byCode(
    @Ctx() context: RequestContext,
    @Param() params: TourCodeParamDto,
    @Query() query: TourLanguageQueryDto,
  ): Promise<TourDetailResponseDto> {
    return this.tours.byCode(context, params.publicCode, query.lang);
  }

  @Get(':id')
  @Auth('PUBLIC')
  @RateLimit('LINK_READ')
  @ApiOperation({
    summary: 'A tour, its stops at their positions — a stop whose Place is not live is a gap.',
  })
  @ApiEnvelope(TourDetailResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'TOUR_UNAVAILABLE')
  @ZodSerializerDto(TourDetailResponseDto)
  get(
    @Ctx() context: RequestContext,
    @Param() params: TourIdParamDto,
    @Query() query: TourLanguageQueryDto,
  ): Promise<TourDetailResponseDto> {
    return this.tours.get(context, params.id, query.lang);
  }
}
