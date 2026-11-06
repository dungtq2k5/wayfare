import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Paged } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import type { Env } from '../../config/env.schema';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import {
  toAdminTourListItemResponseDto,
  toAdminTourResponseDto,
  toCreateTourRequest,
  toTourAdminServiceListToursRequest,
  toTourActivationResultResponseDto,
  toUpdateTourRequest,
} from './admin-tour.mapper';
import type {
  AdminTourListItemResponseDto,
  AdminTourResponseDto,
  AdminTourResultResponseDto,
  TourActivationResultResponseDto,
} from './dto/admin-tour-response.dto';
import type {
  CreateTourDto,
  ListToursQueryDto,
  ReplaceTourStopsDto,
  UpdateTourDto,
} from './dto/admin-tour.dto';

type Result = Promise<AdminTourResultResponseDto>;
const result = (response: { tour?: Parameters<typeof toAdminTourResponseDto>[0] }) => ({
  tour: toAdminTourResponseDto(response.tour),
});

/** `/admin/tours`, backed by `catalog.TourAdminService`. */
@Injectable()
export class AdminToursService {
  private readonly qrBaseUrl: string;

  constructor(
    private readonly catalog: CatalogServiceGrpcClient,
    config: ConfigService<Env, true>,
  ) {
    this.qrBaseUrl = config.get('PUBLIC_QR_BASE_URL', { infer: true });
  }

  async list(
    context: AccountContext,
    query: ListToursQueryDto,
  ): Promise<Paged<AdminTourListItemResponseDto>> {
    const response = await this.catalog.tourAdmin.call(
      'listTours',
      toTourAdminServiceListToursRequest(query),
      context,
    );
    return Paged.page(
      response.tours.map(toAdminTourListItemResponseDto),
      response.page?.page ?? query.page,
      response.page?.pageSize ?? query.pageSize,
      response.page?.total ?? 0,
    );
  }

  async get(context: AccountContext, tourId: string): Promise<AdminTourResponseDto> {
    const response = await this.catalog.tourAdmin.call('getTourAdmin', { tourId }, context);
    return toAdminTourResponseDto(response.tour);
  }

  async create(context: AccountContext, body: CreateTourDto): Result {
    return result(
      await this.catalog.tourAdmin.call('createTour', toCreateTourRequest(body), context),
    );
  }

  async update(context: AccountContext, tourId: string, body: UpdateTourDto): Result {
    return result(
      await this.catalog.tourAdmin.call('updateTour', toUpdateTourRequest(tourId, body), context),
    );
  }

  async replaceStops(context: AccountContext, tourId: string, body: ReplaceTourStopsDto): Result {
    return result(
      await this.catalog.tourAdmin.call(
        'replaceTourStops',
        { tourId, placeIds: body.stops },
        context,
      ),
    );
  }

  async activate(
    context: AccountContext,
    tourId: string,
  ): Promise<TourActivationResultResponseDto> {
    return toTourActivationResultResponseDto(
      await this.catalog.tourAdmin.call('requestTourActivation', { tourId }, context),
    );
  }

  async deactivate(context: AccountContext, tourId: string): Result {
    return result(await this.catalog.tourAdmin.call('deactivateTour', { tourId }, context));
  }

  async remove(context: AccountContext, tourId: string): Promise<void> {
    await this.catalog.tourAdmin.call('deleteTour', { tourId }, context);
  }

  async restore(context: AccountContext, tourId: string): Result {
    return result(await this.catalog.tourAdmin.call('restoreTour', { tourId }, context));
  }

  /** The sticker, encoding `PUBLIC_QR_BASE_URL/q/<code>`. */
  async qr(context: AccountContext, tourId: string): Promise<string> {
    const response = await this.catalog.tourAdmin.call(
      'getTourQr',
      { tourId, qrBaseUrl: this.qrBaseUrl },
      context,
    );
    return response.svg;
  }
}
