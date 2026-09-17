import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, Auth, Ctx, ETagged, UsesUpstream } from '@wayfare/nest-common';
import type { ETaggedResult, RequestContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { PlaceDetailResponseDto, PlaceSummaryResponseDto } from './dto/place-response.dto';
import {
  NearbyPlacesQueryDto,
  PlaceIdParamDto,
  PlaceLanguageQueryDto,
  PublicCodeParamDto,
} from './dto/place.dto';
import { PlacesService } from './places.service';

/** `/places` — discovery and detail for tourists (api-endpoints-plan §2.1). */
@ApiTags('places')
@UsesUpstream()
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('nearby')
  @Auth('DEVICE')
  @ApiOperation({
    summary:
      'Live Places around a point, nearest first; a boosted one moved ahead is marked `sponsored`.',
  })
  @ApiEnvelope(PlaceSummaryResponseDto, { array: true })
  @ZodSerializerDto([PlaceSummaryResponseDto])
  nearby(
    @Ctx() context: RequestContext,
    @Query() query: NearbyPlacesQueryDto,
  ): Promise<PlaceSummaryResponseDto[]> {
    return this.places.nearby(context, query);
  }

  @Get('by-code/:publicCode')
  @Auth('DEVICE')
  @ApiOperation({ summary: 'A Place by its printed code, after a QR deep link.' })
  @ApiEnvelope(PlaceDetailResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'PLACE_UNAVAILABLE')
  @ZodSerializerDto(PlaceDetailResponseDto)
  byCode(
    @Ctx() context: RequestContext,
    @Param() params: PublicCodeParamDto,
    @Query() query: PlaceLanguageQueryDto,
  ): Promise<PlaceDetailResponseDto> {
    return this.places.byCode(context, params.publicCode, query.lang);
  }

  @Get(':id')
  @Auth('DEVICE')
  @ETagged()
  @ApiOperation({ summary: 'A live Place in full, in the requested language.' })
  @ApiEnvelope(PlaceDetailResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(PlaceDetailResponseDto)
  get(
    @Ctx() context: RequestContext,
    @Param() params: PlaceIdParamDto,
    @Query() query: PlaceLanguageQueryDto,
  ): Promise<ETaggedResult<PlaceDetailResponseDto>> {
    return this.places.get(context, params.id, query.lang);
  }
}
