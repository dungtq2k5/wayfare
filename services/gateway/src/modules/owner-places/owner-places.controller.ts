import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, Auth, Ctx, NoStore, UsesUpstream } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  OwnerLimitsResponseDto,
  OwnerPlaceDetailResponseDto,
  OwnerPlaceResponseDto,
  OwnerPlaceResultResponseDto,
} from './dto/owner-place-response.dto';
import { OwnerPlaceIdParamDto } from './dto/owner-place.dto';
import { OwnerPlacesService } from './owner-places.service';

/**
 * `/owner/places` (api-endpoints-plan §3.1): a verified owner's own Venues. Another owner's Venue
 * is not found; changes go through `/owner/submissions`.
 */
@ApiTags('owner-places')
@UsesUpstream()
@Controller('owner/places')
export class OwnerPlacesController {
  constructor(private readonly places: OwnerPlacesService) {}

  @Get()
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'The owner’s Venues, every status, each with its pending submission.' })
  @ApiEnvelope(OwnerPlaceResponseDto, { array: true })
  @ZodSerializerDto([OwnerPlaceResponseDto])
  list(@Ctx() context: AccountContext): Promise<OwnerPlaceResponseDto[]> {
    return this.places.list(context);
  }

  // Before `:id`, so the router never reads `limits` as an id.
  @Get('limits')
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'The effective limits and what uses them.' })
  @ApiEnvelope(OwnerLimitsResponseDto)
  @ApiErrors('ENTITLEMENTS_UNAVAILABLE')
  @ZodSerializerDto(OwnerLimitsResponseDto)
  limits(@Ctx() context: AccountContext): Promise<OwnerLimitsResponseDto> {
    return this.places.limits(context);
  }

  @Get(':id')
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'A Venue as tourists see it, beside what is waiting for review.' })
  @ApiEnvelope(OwnerPlaceDetailResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(OwnerPlaceDetailResponseDto)
  get(
    @Ctx() context: AccountContext,
    @Param() params: OwnerPlaceIdParamDto,
  ): Promise<OwnerPlaceDetailResponseDto> {
    return this.places.get(context, params.id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'Take a live Venue off the map, keeping the listing.' })
  @ApiEnvelope(OwnerPlaceResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'INVALID_STATE')
  @ZodSerializerDto(OwnerPlaceResultResponseDto)
  deactivate(
    @Ctx() context: AccountContext,
    @Param() params: OwnerPlaceIdParamDto,
  ): Promise<OwnerPlaceResultResponseDto> {
    return this.places.deactivate(context, params.id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'Bring a Venue back through the activation gate, within the plan.' })
  @ApiEnvelope(OwnerPlaceResultResponseDto)
  @ApiErrors(
    'RESOURCE_NOT_FOUND',
    'INVALID_STATE',
    'PLACE_LIMIT_REACHED',
    'ENTITLEMENTS_UNAVAILABLE',
  )
  @ZodSerializerDto(OwnerPlaceResultResponseDto)
  reactivate(
    @Ctx() context: AccountContext,
    @Param() params: OwnerPlaceIdParamDto,
  ): Promise<OwnerPlaceResultResponseDto> {
    return this.places.reactivate(context, params.id);
  }
}
