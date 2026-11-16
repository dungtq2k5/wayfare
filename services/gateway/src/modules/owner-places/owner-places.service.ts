import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AccountContext } from '@wayfare/nest-common';
import type { Env } from '../../config/env.schema';
import { toAdminPlaceResponseDto } from '../admin-places/admin-place.mapper';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { toSubmissionResponseDto } from '../owner-submissions/owner-submission.mapper';
import type {
  OwnerLimitsResponseDto,
  OwnerPlaceDetailResponseDto,
  OwnerPlaceResponseDto,
  OwnerPlaceResultResponseDto,
} from './dto/owner-place-response.dto';
import { OwnerBoostsService } from '../owner-boosts/owner-boosts.service';
import { toOwnerLimitsResponseDto, toOwnerPlaceResponseDto } from './owner-place.mapper';

/** `/owner/places`, backed by `catalog.OwnerPlaceService` (api-endpoints-plan §3.1). */
@Injectable()
export class OwnerPlacesService {
  private readonly qrBaseUrl: string;

  constructor(
    private readonly catalog: CatalogServiceGrpcClient,
    private readonly boosts: OwnerBoostsService,
    config: ConfigService<Env, true>,
  ) {
    this.qrBaseUrl = config.get('PUBLIC_QR_BASE_URL', { infer: true });
  }

  /**
   * The owner's Venues, each with its boost composed from billing — catalog knows the weight, not
   * since when. When billing doesn't answer, `boosted` is left out (unknown) and the list loads.
   */
  async list(context: AccountContext): Promise<OwnerPlaceResponseDto[]> {
    const [response, live] = await Promise.all([
      this.catalog.ownerPlaces.call('listMyPlaces', {}, context),
      this.boosts.liveSince(context),
    ]);
    return response.places.map((place) => withBoost(toOwnerPlaceResponseDto(place), live));
  }

  async limits(context: AccountContext): Promise<OwnerLimitsResponseDto> {
    return toOwnerLimitsResponseDto(
      await this.catalog.ownerPlaces.call('getMyLimits', {}, context),
    );
  }

  async get(context: AccountContext, placeId: string): Promise<OwnerPlaceDetailResponseDto> {
    const [response, live] = await Promise.all([
      this.catalog.ownerPlaces.call('getMyPlace', { placeId }, context),
      this.boosts.liveSince(context),
    ]);
    return {
      ...boostOf(placeId, live),
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

  /** The sticker, once catalog has said the Venue is the caller's (another's is not found). */
  async qr(context: AccountContext, placeId: string): Promise<string> {
    await this.catalog.ownerPlaces.call('getMyPlace', { placeId }, context);
    const response = await this.catalog.placeAdmin.call(
      'getPlaceQr',
      { placeId, qrBaseUrl: this.qrBaseUrl },
      context,
    );
    return response.svg;
  }
}

/** A Venue's `boosted`, from the owner's live boosts; left out when billing didn't answer. */
function boostOf(
  placeId: string,
  live: ReadonlyMap<string, string> | null,
): { boosted?: { since: string } | null } {
  if (live === null) return {};
  const since = live.get(placeId);
  return { boosted: since === undefined ? null : { since } };
}

/** A row with its `boosted`. */
function withBoost<T extends { readonly id: string }>(
  row: T,
  live: ReadonlyMap<string, string> | null,
): T & { boosted?: { since: string } | null } {
  return { ...row, ...boostOf(row.id, live) };
}
