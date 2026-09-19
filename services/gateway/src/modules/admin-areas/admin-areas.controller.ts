import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AdminArea } from '@wayfare/contracts';
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
import { AdminAreasService } from './admin-areas.service';
import { AdminAreaResponseDto, AdminAreaResultResponseDto } from './dto/admin-area-response.dto';
import { AreaIdParamDto, CreateAreaDto, UpdateAreaDto } from './dto/admin-area.dto';

/**
 * `/admin/areas` — the pilot areas (api-endpoints-plan §3.6, rdm-spec C-3). Adding one is a row, not
 * a deploy; areas never overlap, a boundary always covers its Places, and an area with live Places
 * stays active.
 */
@ApiTags('admin-areas')
@UsesUpstream()
@Controller('admin/areas')
export class AdminAreasController {
  constructor(private readonly areas: AdminAreasService) {}

  @Get()
  @RequirePermission('catalog.taxonomy.manage')
  @NoStore()
  @ApiOperation({ summary: 'Every area, active or not, with its Places by status.' })
  @ApiEnvelope(AdminAreaResponseDto, { array: true })
  @ZodSerializerDto([AdminAreaResponseDto])
  list(@Ctx() context: AccountContext): Promise<AdminArea[]> {
    return this.areas.list(context);
  }

  @Get(':id')
  @RequirePermission('catalog.taxonomy.manage')
  @NoStore()
  @ApiOperation({ summary: 'One area: its boundary as GeoJSON, with its Places by status.' })
  @ApiEnvelope(AdminAreaResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(AdminAreaResultResponseDto)
  get(
    @Ctx() context: AccountContext,
    @Param() params: AreaIdParamDto,
  ): Promise<{ area: AdminArea }> {
    return this.areas.get(context, params.id);
  }

  @Post()
  @RequirePermission('catalog.taxonomy.manage')
  @NoStore()
  @ApiOperation({ summary: 'Create an area; an overlap with an active area is refused.' })
  @ApiEnvelope(AdminAreaResultResponseDto)
  @ApiErrors('AREA_OVERLAPS')
  @ZodSerializerDto(AdminAreaResultResponseDto)
  create(
    @Ctx() context: AccountContext,
    @Body() body: CreateAreaDto,
  ): Promise<{ area: AdminArea }> {
    return this.areas.create(context, body);
  }

  @Patch(':id')
  @RequirePermission('catalog.taxonomy.manage')
  @NoStore()
  @ApiOperation({
    summary:
      'Change any field but the code. Refuses an overlap, a boundary that leaves a Place outside, ' +
      'and deactivating an area with live Places.',
  })
  @ApiEnvelope(AdminAreaResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'AREA_OVERLAPS', 'AREA_EXCLUDES_PLACES', 'AREA_HAS_LIVE_PLACES')
  @ZodSerializerDto(AdminAreaResultResponseDto)
  update(
    @Ctx() context: AccountContext,
    @Param() params: AreaIdParamDto,
    @Body() body: UpdateAreaDto,
  ): Promise<{ area: AdminArea }> {
    return this.areas.update(context, params.id, body);
  }
}
