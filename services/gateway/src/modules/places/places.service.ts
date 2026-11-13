import { Injectable } from '@nestjs/common';
import type { PlaceSummary, RequestedLanguage } from '@wayfare/contracts';
import { ETaggedResult } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { toPlaceSummary } from '../catalog/catalog.mapper';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import type { PlaceDetailResponseDto } from './dto/place-response.dto';
import type { NearbyPlacesQueryDto } from './dto/place.dto';
import { toPlaceDetailResponseDto } from './place.mapper';

/** `/places/nearby`, `/places/:id`, `/places/by-code/:publicCode`, backed by catalog. */
@Injectable()
export class PlacesService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  async nearby(context: RequestContext, query: NearbyPlacesQueryDto): Promise<PlaceSummary[]> {
    const response = await this.catalog.placeQueries.call(
      'nearbyPlaces',
      {
        lat: query.lat,
        lng: query.lng,
        radiusM: query.radiusM,
        lang: query.lang.tag,
        ...(query.categoryCode === undefined ? {} : { categoryCode: query.categoryCode }),
        limit: query.limit,
      },
      context,
    );
    return response.places.map(toPlaceSummary);
  }

  /**
   * A live Place, tagged `"<id>:<lang>:<etagVersion>:<isFavorite>"` — its version for the language
   * (rdm-spec §1.7), so another language's translation leaves it alone. Favouriting changes no
   * content, and the tag must still move, or a re-read after toggling it answers `304` with the
   * caller's own stale value (api-endpoints-plan §2.1).
   */
  async get(
    context: RequestContext,
    placeId: string,
    lang: RequestedLanguage,
  ): Promise<ETaggedResult<PlaceDetailResponseDto>> {
    const response = await this.catalog.placeQueries.call(
      'getPlace',
      { placeId, lang: lang.tag },
      context,
    );
    return ETaggedResult.of(
      toPlaceDetailResponseDto(response.place),
      `${placeId}:${lang.tag}:${response.place?.etagVersion ?? ''}:${response.place?.isFavorite ?? false}`,
    );
  }

  async byCode(
    context: RequestContext,
    publicCode: string,
    lang: RequestedLanguage,
  ): Promise<PlaceDetailResponseDto> {
    const response = await this.catalog.placeQueries.call(
      'getPlaceByCode',
      { publicCode, lang: lang.tag },
      context,
    );
    return toPlaceDetailResponseDto(response.place);
  }
}
