import { Injectable } from '@nestjs/common';
import type { AccountContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import type { ConfirmUploadResponseDto, CreateUploadResponseDto } from './dto/upload-response.dto';
import type { CreateUploadDto } from './dto/upload.dto';
import {
  toConfirmUploadResponseDto,
  toCreateUploadRequest,
  toCreateUploadResponseDto,
} from './upload.mapper';

/** `/uploads`, backed by `catalog.UploadService`. */
@Injectable()
export class UploadsService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  async create(context: AccountContext, body: CreateUploadDto): Promise<CreateUploadResponseDto> {
    const response = await this.catalog.uploads.call(
      'createUpload',
      toCreateUploadRequest(body),
      context,
    );
    return toCreateUploadResponseDto(response);
  }

  async confirm(context: AccountContext, uploadId: string): Promise<ConfirmUploadResponseDto> {
    // Converting a photo takes longer than a read.
    const response = await this.catalog.uploads.call('confirmUpload', { uploadId }, context, {
      deadlineMs: 20_000,
    });
    return toConfirmUploadResponseDto(response);
  }
}
