import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MapPack } from '@wayfare/contracts';
import {
  ApiEnvelope,
  ApiErrors,
  Ctx,
  NoStore,
  RequirePermission,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminMapPacksService } from './admin-map-packs.service';
import { MapPackResponseDto, MapPackResultResponseDto } from './dto/admin-map-pack-response.dto';
import { MapPackIdParamDto, MapPacksQueryDto, RegisterMapPackDto } from './dto/admin-map-pack.dto';

/**
 * `/admin/map-packs` — the self-hosted maps (api-endpoints-plan §3.6, rdm-spec C-14). A pack
 * built by `infra/tiles` is registered, re-hashed object by object, then published.
 */
@ApiTags('admin-map-packs')
@UsesUpstream()
@Controller('admin/map-packs')
export class AdminMapPacksController {
  constructor(private readonly mapPacks: AdminMapPacksService) {}

  @Get()
  @RequirePermission('map_pack.manage')
  @NoStore()
  @ApiOperation({ summary: 'Every map pack, newest version first per area.' })
  @ApiEnvelope(MapPackResponseDto, { array: true })
  @ZodSerializerDto([MapPackResponseDto])
  list(@Ctx() context: AccountContext, @Query() query: MapPacksQueryDto): Promise<MapPack[]> {
    return this.mapPacks.list(context, query.areaId);
  }

  @Post()
  @RequirePermission('map_pack.manage')
  @NoStore()
  @ApiOperation({
    summary:
      'Register an uploaded build: every object under its prefix, re-hashed; the server assigns the version.',
  })
  @ApiEnvelope(MapPackResultResponseDto)
  @ApiErrors(
    'RESOURCE_NOT_FOUND',
    'MAP_PACK_HASH_MISMATCH',
    'MAP_PACK_OBJECT_MISSING',
    'MAP_PACK_TOO_LARGE',
  )
  @ZodSerializerDto(MapPackResultResponseDto)
  register(
    @Ctx() context: AccountContext,
    @Body() body: RegisterMapPackDto,
  ): Promise<{ mapPack: MapPack }> {
    return this.mapPacks.register(context, body);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('map_pack.manage')
  @NoStore()
  @ApiOperation({ summary: 'Publish a pack; the area’s previous one is retired.' })
  @ApiEnvelope(MapPackResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'INVALID_STATE')
  @ZodSerializerDto(MapPackResultResponseDto)
  publish(
    @Ctx() context: AccountContext,
    @Param() params: MapPackIdParamDto,
  ): Promise<{ mapPack: MapPack }> {
    return this.mapPacks.publish(context, params.id);
  }
}
