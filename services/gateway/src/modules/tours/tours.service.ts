import { Injectable } from '@nestjs/common';
import type { RequestedLanguage, TourDetail, TourSummary } from '@wayfare/contracts';
import { Paged } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import type { TourListQueryDto } from './dto/tour.dto';
import { toTourDetail, toTourSummary } from './tour.mapper';

/** `/tours`, backed by `catalog.TourQueryService`. */
@Injectable()
export class ToursService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  async list(context: RequestContext, query: TourListQueryDto): Promise<Paged<TourSummary>> {
    const response = await this.catalog.tourQueries.call(
      'listTours',
      {
        areaId: query.areaId,
        lang: query.lang.tag,
        page: {
          limit: query.limit,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        },
      },
      context,
    );
    return Paged.cursor(response.tours.map(toTourSummary), response.page?.nextCursor ?? null);
  }

  async get(context: RequestContext, tourId: string, lang: RequestedLanguage): Promise<TourDetail> {
    const response = await this.catalog.tourQueries.call(
      'getTour',
      { tourId, lang: lang.tag },
      context,
    );
    return toTourDetail(response.tour);
  }

  async byCode(
    context: RequestContext,
    publicCode: string,
    lang: RequestedLanguage,
  ): Promise<TourDetail> {
    const response = await this.catalog.tourQueries.call(
      'getTourByCode',
      { publicCode, lang: lang.tag },
      context,
    );
    return toTourDetail(response.tour);
  }
}
