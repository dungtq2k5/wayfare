import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, Auth, Ctx, NoStore, UsesUpstream } from '@wayfare/nest-common';
import type { Paged, RequestContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { FavoriteResponseDto } from './dto/favorite-response.dto';
import { FavoritePlaceParamDto, FavoritesQueryDto } from './dto/favorite.dto';
import { FavoritesService } from './favorites.service';

/**
 * `/me/favorites` — a device's saved Places (api-endpoints-plan §2.3). A signed-in device sees and
 * removes across every device of its account; an anonymous one only its own.
 */
@ApiTags('favorites')
@UsesUpstream()
@Controller('me/favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @Auth('DEVICE')
  @NoStore()
  @ApiOperation({ summary: 'Saved Places, newest first, in the language asked.' })
  @ApiEnvelope(FavoriteResponseDto, { list: 'cursor' })
  @ZodSerializerDto(FavoriteResponseDto)
  list(
    @Ctx() context: RequestContext,
    @Query() query: FavoritesQueryDto,
  ): Promise<Paged<FavoriteResponseDto>> {
    return this.favorites.list(context, query);
  }

  @Put(':placeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('DEVICE')
  @NoStore()
  @ApiOperation({ summary: 'Save a live Place. Saving it again changes nothing.' })
  @ApiEnvelope(null)
  @ApiErrors('RESOURCE_NOT_FOUND')
  add(@Ctx() context: RequestContext, @Param() params: FavoritePlaceParamDto): Promise<void> {
    return this.favorites.add(context, params.placeId);
  }

  @Delete(':placeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('DEVICE')
  @NoStore()
  @ApiOperation({ summary: 'Remove a saved Place. Removing it again changes nothing.' })
  @ApiEnvelope(null)
  remove(@Ctx() context: RequestContext, @Param() params: FavoritePlaceParamDto): Promise<void> {
    return this.favorites.remove(context, params.placeId);
  }
}
