import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  Ctx,
  NoStore,
  RequirePermission,
  SkipEnvelope,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext, Paged } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminPlacesService } from './admin-places.service';
import {
  ActivationResultResponseDto,
  AdminPlaceListItemResponseDto,
  AdminPlaceResponseDto,
  AdminPlaceResultResponseDto,
} from './dto/admin-place-response.dto';
import {
  AdminPlaceIdParamDto,
  CreatePlaceDto,
  DeactivatePlaceDto,
  ListPlacesQueryDto,
  ReplaceMenuDto,
  ReplaceOpeningHoursDto,
  ReplacePhotosDto,
  UpdateEditorialDto,
  UpdatePlaceDto,
} from './dto/admin-place.dto';

const WRITE_ERRORS = ['RESOURCE_NOT_FOUND', 'INVALID_STATE'] as const;

/**
 * `/admin/places` (api-endpoints-plan §3.5). The permission check is here; catalog enforces the
 * lifecycle, the gate and the editorial firewall.
 */
@ApiTags('admin-places')
@UsesUpstream()
@Controller('admin/places')
export class AdminPlacesController {
  constructor(private readonly places: AdminPlacesService) {}

  @Get()
  @RequirePermission('place.read')
  @NoStore()
  @ApiOperation({ summary: 'List Places, a page at a time, deleted ones on request.' })
  @ApiEnvelope(AdminPlaceListItemResponseDto, { list: 'page' })
  @ZodSerializerDto(AdminPlaceListItemResponseDto)
  list(
    @Ctx() context: AccountContext,
    @Query() query: ListPlacesQueryDto,
  ): Promise<Paged<AdminPlaceListItemResponseDto>> {
    return this.places.list(context, query);
  }

  @Get(':id')
  @RequirePermission('place.read')
  @NoStore()
  @ApiOperation({ summary: 'One Place in full, with readiness per language.' })
  @ApiEnvelope(AdminPlaceResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(AdminPlaceResponseDto)
  get(
    @Ctx() context: AccountContext,
    @Param() params: AdminPlaceIdParamDto,
  ): Promise<AdminPlaceResponseDto> {
    return this.places.get(context, params.id);
  }

  @Post()
  @RequirePermission('place.create')
  @NoStore()
  @ApiOperation({
    summary: 'Create an Editorial Place, a Draft or — with requestActivation — processing.',
  })
  @ApiEnvelope(AdminPlaceResultResponseDto)
  @ApiErrors(
    'CATEGORY_NOT_APPLICABLE',
    'LOCATION_OUTSIDE_AREAS',
    'UPLOAD_NOT_READY',
    'RESOURCE_NOT_FOUND',
    'SHORT_CODE_COLLISION',
  )
  @ZodSerializerDto(AdminPlaceResultResponseDto)
  create(
    @Ctx() context: AccountContext,
    @Body() body: CreatePlaceDto,
  ): Promise<AdminPlaceResultResponseDto> {
    return this.places.create(context, body);
  }

  @Patch(':id')
  @RequirePermission('place.update')
  @NoStore()
  @ApiOperation({
    summary: 'Edit content. A changed name or description sends a live Place back to processing.',
  })
  @ApiEnvelope(AdminPlaceResultResponseDto)
  @ApiErrors(...WRITE_ERRORS, 'CATEGORY_NOT_APPLICABLE', 'LOCATION_OUTSIDE_AREAS')
  @ZodSerializerDto(AdminPlaceResultResponseDto)
  update(
    @Ctx() context: AccountContext,
    @Param() params: AdminPlaceIdParamDto,
    @Body() body: UpdatePlaceDto,
  ): Promise<AdminPlaceResultResponseDto> {
    return this.places.update(context, params.id, body);
  }

  @Patch(':id/editorial')
  @RequirePermission('place.editorial.update')
  @NoStore()
  @ApiOperation({ summary: 'Set the trigger radius and narration priority. Status never changes.' })
  @ApiEnvelope(AdminPlaceResultResponseDto)
  @ApiErrors(...WRITE_ERRORS)
  @ZodSerializerDto(AdminPlaceResultResponseDto)
  updateEditorial(
    @Ctx() context: AccountContext,
    @Param() params: AdminPlaceIdParamDto,
    @Body() body: UpdateEditorialDto,
  ): Promise<AdminPlaceResultResponseDto> {
    return this.places.updateEditorial(context, params.id, body);
  }

  @Put(':id/photos')
  @RequirePermission('place.update')
  @NoStore()
  @ApiOperation({ summary: 'Replace the ordered photo set: kept photos and confirmed uploads.' })
  @ApiEnvelope(AdminPlaceResultResponseDto)
  @ApiErrors(...WRITE_ERRORS, 'UPLOAD_NOT_READY')
  @ZodSerializerDto(AdminPlaceResultResponseDto)
  replacePhotos(
    @Ctx() context: AccountContext,
    @Param() params: AdminPlaceIdParamDto,
    @Body() body: ReplacePhotosDto,
  ): Promise<AdminPlaceResultResponseDto> {
    return this.places.replacePhotos(context, params.id, body);
  }

  @Put(':id/menu')
  @RequirePermission('place.update')
  @NoStore()
  @ApiOperation({ summary: "Replace a Venue's menu. An Editorial Place has none." })
  @ApiEnvelope(AdminPlaceResultResponseDto)
  @ApiErrors(...WRITE_ERRORS)
  @ZodSerializerDto(AdminPlaceResultResponseDto)
  replaceMenu(
    @Ctx() context: AccountContext,
    @Param() params: AdminPlaceIdParamDto,
    @Body() body: ReplaceMenuDto,
  ): Promise<AdminPlaceResultResponseDto> {
    return this.places.replaceMenu(context, params.id, body);
  }

  @Put(':id/opening-hours')
  @RequirePermission('place.update')
  @NoStore()
  @ApiOperation({ summary: 'Replace the opening hours.' })
  @ApiEnvelope(AdminPlaceResultResponseDto)
  @ApiErrors(...WRITE_ERRORS)
  @ZodSerializerDto(AdminPlaceResultResponseDto)
  replaceOpeningHours(
    @Ctx() context: AccountContext,
    @Param() params: AdminPlaceIdParamDto,
    @Body() body: ReplaceOpeningHoursDto,
  ): Promise<AdminPlaceResultResponseDto> {
    return this.places.replaceOpeningHours(context, params.id, body);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('place.publish')
  @NoStore()
  @ApiOperation({
    summary: 'Ask for publication; the answer says what the activation gate still waits for.',
  })
  @ApiEnvelope(ActivationResultResponseDto)
  @ApiErrors(...WRITE_ERRORS)
  @ZodSerializerDto(ActivationResultResponseDto)
  activate(
    @Ctx() context: AccountContext,
    @Param() params: AdminPlaceIdParamDto,
  ): Promise<ActivationResultResponseDto> {
    return this.places.activate(context, params.id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('place.publish')
  @NoStore()
  @ApiOperation({ summary: 'Take a live or processing Place offline.' })
  @ApiEnvelope(AdminPlaceResultResponseDto)
  @ApiErrors(...WRITE_ERRORS)
  @ZodSerializerDto(AdminPlaceResultResponseDto)
  deactivate(
    @Ctx() context: AccountContext,
    @Param() params: AdminPlaceIdParamDto,
    @Body() body: DeactivatePlaceDto,
  ): Promise<AdminPlaceResultResponseDto> {
    return this.places.deactivate(context, params.id, body.reason);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('place.delete')
  @NoStore()
  @ApiOperation({ summary: 'Soft-delete a Place. Its code stays reserved.' })
  @ApiEnvelope(null)
  @ApiErrors(...WRITE_ERRORS, 'PLACE_HAS_LIVE_VOUCHERS')
  async delete(
    @Ctx() context: AccountContext,
    @Param() params: AdminPlaceIdParamDto,
  ): Promise<void> {
    await this.places.delete(context, params.id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('place.delete')
  @NoStore()
  @ApiOperation({ summary: 'Restore a deleted Place with the status it had.' })
  @ApiEnvelope(AdminPlaceResultResponseDto)
  @ApiErrors(...WRITE_ERRORS)
  @ZodSerializerDto(AdminPlaceResultResponseDto)
  restore(
    @Ctx() context: AccountContext,
    @Param() params: AdminPlaceIdParamDto,
  ): Promise<AdminPlaceResultResponseDto> {
    return this.places.restore(context, params.id);
  }

  @Get(':id/qr')
  @RequirePermission('place.read')
  @NoStore()
  @SkipEnvelope()
  @Header('Content-Type', 'image/svg+xml')
  @ApiOperation({ summary: "A print-ready SVG of the Place's QR sticker, the code beneath." })
  @ApiEnvelope(null, { status: 200, mediaType: 'image/svg+xml' })
  @ApiErrors('RESOURCE_NOT_FOUND')
  qr(@Ctx() context: AccountContext, @Param() params: AdminPlaceIdParamDto): Promise<string> {
    return this.places.qr(context, params.id);
  }
}
