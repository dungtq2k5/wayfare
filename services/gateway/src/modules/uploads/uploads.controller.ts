import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { ConfirmUploadResponseDto, CreateUploadResponseDto } from './dto/upload-response.dto';
import { CreateUploadDto, UploadIdParamDto } from './dto/upload.dto';
import { UploadsService } from './uploads.service';

/**
 * `/uploads` (api-endpoints-plan §3.2): a signed PUT straight to storage, then a confirm that
 * checks and converts what arrived. Staff who create or edit Places, and verified owners for their
 * submissions (api-endpoints-plan §3.2): holding any one of the permissions is enough.
 */
@ApiTags('uploads')
@UsesUpstream()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @RequirePermission('place.create', 'place.update', 'owner.access')
  @NoStore()
  @ApiOperation({ summary: 'Sign an upload bound to its content type and the size limit.' })
  @ApiEnvelope(CreateUploadResponseDto)
  @ApiErrors('UPLOAD_TOO_LARGE')
  @ZodSerializerDto(CreateUploadResponseDto)
  create(
    @Ctx() context: AccountContext,
    @Body() body: CreateUploadDto,
  ): Promise<CreateUploadResponseDto> {
    return this.uploads.create(context, body);
  }

  @Post(':uploadId/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('place.create', 'place.update', 'owner.access')
  @NoStore()
  @ApiOperation({
    summary:
      'Check an uploaded image and convert it to stripped WebP variants; the original is deleted.',
  })
  @ApiEnvelope(ConfirmUploadResponseDto)
  @ApiErrors('UPLOAD_NOT_READY', 'UPLOAD_TYPE_MISMATCH', 'UPLOAD_TOO_LARGE')
  @ZodSerializerDto(ConfirmUploadResponseDto)
  confirm(
    @Ctx() context: AccountContext,
    @Param() params: UploadIdParamDto,
  ): Promise<ConfirmUploadResponseDto> {
    return this.uploads.confirm(context, params.uploadId);
  }
}
