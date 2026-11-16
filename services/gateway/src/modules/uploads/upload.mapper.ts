import { uploadPurposeProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { fromProtoTimestamp } from '@wayfare/nest-common';
import { toPhotoView } from '../catalog/catalog.mapper';
import type { ConfirmUploadResponseDto, CreateUploadResponseDto } from './dto/upload-response.dto';
import type { CreateUploadDto } from './dto/upload.dto';

/** The `CreateUpload` request. */
export function toCreateUploadRequest(body: CreateUploadDto): catalogGrpc.CreateUploadRequest {
  return {
    purpose: uploadPurposeProto.toProto(body.purpose),
    contentType: body.contentType,
    bytes: body.bytes,
  };
}

/** A signed upload. */
export function toCreateUploadResponseDto(
  response: catalogGrpc.CreateUploadResponse,
): CreateUploadResponseDto {
  return {
    uploadId: response.uploadId,
    uploadUrl: response.uploadUrl,
    expiresAt: fromProtoTimestamp(response.expiresAt, 'expiresAt').toISOString(),
    requiredHeaders: { ...response.requiredHeaders },
  };
}

/** A confirmed upload's variants. */
export function toConfirmUploadResponseDto(
  response: catalogGrpc.ConfirmUploadResponse,
): ConfirmUploadResponseDto {
  return {
    uploadId: response.uploadId,
    variants: {
      thumb: toPhotoView(response.variants?.thumb),
      card: toPhotoView(response.variants?.card),
      full: toPhotoView(response.variants?.full),
    },
  };
}
