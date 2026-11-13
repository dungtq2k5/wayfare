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
import { AdminToursService } from './admin-tours.service';
import {
  AdminTourListItemResponseDto,
  AdminTourResponseDto,
  AdminTourResultResponseDto,
  TourActivationResultResponseDto,
} from './dto/admin-tour-response.dto';
import {
  AdminTourIdParamDto,
  CreateTourDto,
  ListToursQueryDto,
  ReplaceTourStopsDto,
  UpdateTourDto,
} from './dto/admin-tour.dto';

const WRITE_ERRORS = ['RESOURCE_NOT_FOUND', 'INVALID_STATE'] as const;

/**
 * `/admin/tours` (api-endpoints-plan §3.6), each `tour.manage`. catalog enforces the lifecycle, the
 * gate on the English text and the stop rules.
 */
@ApiTags('admin-tours')
@UsesUpstream()
@Controller('admin/tours')
export class AdminToursController {
  constructor(private readonly tours: AdminToursService) {}

  @Get()
  @RequirePermission('tour.manage')
  @NoStore()
  @ApiOperation({ summary: 'List tours with their live stops, deleted ones on request.' })
  @ApiEnvelope(AdminTourListItemResponseDto, { list: 'page' })
  @ZodSerializerDto(AdminTourListItemResponseDto)
  list(
    @Ctx() context: AccountContext,
    @Query() query: ListToursQueryDto,
  ): Promise<Paged<AdminTourListItemResponseDto>> {
    return this.tours.list(context, query);
  }

  @Get(':id')
  @RequirePermission('tour.manage')
  @NoStore()
  @ApiOperation({ summary: 'One tour in full: its stops as they stand, translations and gate.' })
  @ApiEnvelope(AdminTourResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(AdminTourResponseDto)
  get(
    @Ctx() context: AccountContext,
    @Param() params: AdminTourIdParamDto,
  ): Promise<AdminTourResponseDto> {
    return this.tours.get(context, params.id);
  }

  @Post()
  @RequirePermission('tour.manage')
  @NoStore()
  @ApiOperation({
    summary: 'Create a tour, a Draft or — with requestActivation, two stops at least — processing.',
  })
  @ApiEnvelope(AdminTourResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND', 'UPLOAD_NOT_READY', 'AREA_INACTIVE', 'SHORT_CODE_COLLISION')
  @ZodSerializerDto(AdminTourResultResponseDto)
  create(
    @Ctx() context: AccountContext,
    @Body() body: CreateTourDto,
  ): Promise<AdminTourResultResponseDto> {
    return this.tours.create(context, body);
  }

  @Patch(':id')
  @RequirePermission('tour.manage')
  @NoStore()
  @ApiOperation({
    summary: 'Edit text, minutes or cover. A changed text sends a live tour back to processing.',
  })
  @ApiEnvelope(AdminTourResultResponseDto)
  @ApiErrors(...WRITE_ERRORS, 'UPLOAD_NOT_READY')
  @ZodSerializerDto(AdminTourResultResponseDto)
  update(
    @Ctx() context: AccountContext,
    @Param() params: AdminTourIdParamDto,
    @Body() body: UpdateTourDto,
  ): Promise<AdminTourResultResponseDto> {
    return this.tours.update(context, params.id, body);
  }

  @Put(':id/stops')
  @RequirePermission('tour.manage')
  @NoStore()
  @ApiOperation({
    summary:
      'Replace the ordered stops. A Place outside the area or deleted is refused unless already a stop.',
  })
  @ApiEnvelope(AdminTourResultResponseDto)
  @ApiErrors(...WRITE_ERRORS)
  @ZodSerializerDto(AdminTourResultResponseDto)
  replaceStops(
    @Ctx() context: AccountContext,
    @Param() params: AdminTourIdParamDto,
    @Body() body: ReplaceTourStopsDto,
  ): Promise<AdminTourResultResponseDto> {
    return this.tours.replaceStops(context, params.id, body);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tour.manage')
  @NoStore()
  @ApiOperation({ summary: 'Request publication; the answer says what the gate still waits for.' })
  @ApiEnvelope(TourActivationResultResponseDto)
  @ApiErrors(...WRITE_ERRORS, 'AREA_INACTIVE')
  @ZodSerializerDto(TourActivationResultResponseDto)
  activate(
    @Ctx() context: AccountContext,
    @Param() params: AdminTourIdParamDto,
  ): Promise<TourActivationResultResponseDto> {
    return this.tours.activate(context, params.id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tour.manage')
  @NoStore()
  @ApiOperation({ summary: 'Take a tour off for tourists; no reason is asked.' })
  @ApiEnvelope(AdminTourResultResponseDto)
  @ApiErrors(...WRITE_ERRORS)
  @ZodSerializerDto(AdminTourResultResponseDto)
  deactivate(
    @Ctx() context: AccountContext,
    @Param() params: AdminTourIdParamDto,
  ): Promise<AdminTourResultResponseDto> {
    return this.tours.deactivate(context, params.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('tour.manage')
  @NoStore()
  @ApiOperation({ summary: 'Soft-delete a tour. Its Places are not touched.' })
  @ApiEnvelope(null)
  @ApiErrors(...WRITE_ERRORS)
  async remove(
    @Ctx() context: AccountContext,
    @Param() params: AdminTourIdParamDto,
  ): Promise<void> {
    await this.tours.remove(context, params.id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tour.manage')
  @NoStore()
  @ApiOperation({ summary: 'Restore a deleted tour with its status.' })
  @ApiEnvelope(AdminTourResultResponseDto)
  @ApiErrors(...WRITE_ERRORS)
  @ZodSerializerDto(AdminTourResultResponseDto)
  restore(
    @Ctx() context: AccountContext,
    @Param() params: AdminTourIdParamDto,
  ): Promise<AdminTourResultResponseDto> {
    return this.tours.restore(context, params.id);
  }

  @Get(':id/qr')
  @RequirePermission('tour.manage')
  @NoStore()
  @SkipEnvelope()
  @Header('Content-Type', 'image/svg+xml')
  @ApiOperation({ summary: "The tour's QR sticker as SVG, its code printed beneath." })
  @ApiEnvelope(null, { status: 200, mediaType: 'image/svg+xml' })
  @ApiErrors('RESOURCE_NOT_FOUND')
  qr(@Ctx() context: AccountContext, @Param() params: AdminTourIdParamDto): Promise<string> {
    return this.tours.qr(context, params.id);
  }
}
