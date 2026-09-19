import { Injectable } from '@nestjs/common';
import type { AccountContext } from '@wayfare/nest-common';
import { toAdminPlaceResponseDto } from '../admin-places/admin-place.mapper';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { toSubmissionResponseDto } from '../owner-submissions/owner-submission.mapper';
import type {
  OwnerLimitsResponseDto,
  OwnerPlaceDetailResponseDto,
  OwnerPlaceResponseDto,
  OwnerPlaceResultResponseDto,
} from './dto/owner-place-response.dto';
import { toOwnerLimitsResponseDto, toOwnerPlaceResponseDto } from './owner-place.mapper';

/** `/owner/places`, backed by `catalog.OwnerPlaceService` (api-endpoints-plan §3.1). */
@Injectable()
export class OwnerPlacesService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  async list(context: AccountContext): Promise<OwnerPlaceResponseDto[]> {
    const response = await this.catalog.ownerPlaces.call('listMyPlaces', {}, context);
    return response.places.map(toOwnerPlaceResponseDto);
  }

  async limits(context: AccountContext): Promise<OwnerLimitsResponseDto> {
    return toOwnerLimitsResponseDto(
      await this.catalog.ownerPlaces.call('getMyLimits', {}, context),
    );
  }

  async get(context: AccountContext, placeId: string): Promise<OwnerPlaceDetailResponseDto> {
    const response = await this.catalog.ownerPlaces.call('getMyPlace', { placeId }, context);
    return {
      place: toAdminPlaceResponseDto(response.place),
      editableHash: response.editableHash,
      pendingSubmission:
        response.pendingSubmission == null
          ? null
          : toSubmissionResponseDto(response.pendingSubmission),
    };
  }

  async deactivate(context: AccountContext, placeId: string): Promise<OwnerPlaceResultResponseDto> {
    const response = await this.catalog.ownerPlaces.call('deactivateMyPlace', { placeId }, context);
    return { place: toAdminPlaceResponseDto(response.place) };
  }

  async reactivate(context: AccountContext, placeId: string): Promise<OwnerPlaceResultResponseDto> {
    const response = await this.catalog.ownerPlaces.call('reactivateMyPlace', { placeId }, context);
    return { place: toAdminPlaceResponseDto(response.place) };
  }
}
