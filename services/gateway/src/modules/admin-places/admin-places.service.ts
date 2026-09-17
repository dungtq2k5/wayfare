import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Paged } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import type { Env } from '../../config/env.schema';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import {
  toActivationResultResponseDto,
  toAdminPlaceListItemResponseDto,
  toAdminPlaceResponseDto,
  toCreateEditorialPlaceRequest,
  toListPlacesRequest,
  toReplaceMenuRequest,
  toReplaceOpeningHoursRequest,
  toReplacePhotosRequest,
  toUpdatePlaceRequest,
} from './admin-place.mapper';
import type {
  ActivationResultResponseDto,
  AdminPlaceListItemResponseDto,
  AdminPlaceResponseDto,
  AdminPlaceResultResponseDto,
} from './dto/admin-place-response.dto';
import type {
  CreatePlaceDto,
  ListPlacesQueryDto,
  ReplaceMenuDto,
  ReplaceOpeningHoursDto,
  ReplacePhotosDto,
  UpdateEditorialDto,
  UpdatePlaceDto,
} from './dto/admin-place.dto';

type Result = Promise<AdminPlaceResultResponseDto>;
const result = (response: { place?: Parameters<typeof toAdminPlaceResponseDto>[0] }) => ({
  place: toAdminPlaceResponseDto(response.place),
});

/** `/admin/places`, backed by `catalog.PlaceAdminService`. */
@Injectable()
export class AdminPlacesService {
  private readonly qrBaseUrl: string;

  constructor(
    private readonly catalog: CatalogServiceGrpcClient,
    config: ConfigService<Env, true>,
  ) {
    this.qrBaseUrl = config.get('PUBLIC_QR_BASE_URL', { infer: true });
  }

  async list(
    context: AccountContext,
    query: ListPlacesQueryDto,
  ): Promise<Paged<AdminPlaceListItemResponseDto>> {
    const response = await this.catalog.placeAdmin.call(
      'listPlaces',
      toListPlacesRequest(query),
      context,
    );
    const page = response.page;
    return Paged.page(
      response.places.map(toAdminPlaceListItemResponseDto),
      page?.page ?? query.page,
      page?.pageSize ?? query.pageSize,
      page?.total ?? 0,
    );
  }

  async get(context: AccountContext, placeId: string): Promise<AdminPlaceResponseDto> {
    const response = await this.catalog.placeAdmin.call('getPlaceAdmin', { placeId }, context);
    return toAdminPlaceResponseDto(response.place);
  }

  async create(context: AccountContext, body: CreatePlaceDto): Result {
    return result(
      await this.catalog.placeAdmin.call(
        'createEditorialPlace',
        toCreateEditorialPlaceRequest(body),
        context,
      ),
    );
  }

  async update(context: AccountContext, placeId: string, body: UpdatePlaceDto): Result {
    return result(
      await this.catalog.placeAdmin.call(
        'updatePlace',
        toUpdatePlaceRequest(placeId, body),
        context,
      ),
    );
  }

  async updateEditorial(
    context: AccountContext,
    placeId: string,
    body: UpdateEditorialDto,
  ): Result {
    return result(
      await this.catalog.placeAdmin.call('updateEditorial', { placeId, ...body }, context),
    );
  }

  async replacePhotos(context: AccountContext, placeId: string, body: ReplacePhotosDto): Result {
    return result(
      await this.catalog.placeAdmin.call(
        'replacePhotos',
        toReplacePhotosRequest(placeId, body),
        context,
      ),
    );
  }

  async replaceMenu(context: AccountContext, placeId: string, body: ReplaceMenuDto): Result {
    return result(
      await this.catalog.placeAdmin.call(
        'replaceMenu',
        toReplaceMenuRequest(placeId, body),
        context,
      ),
    );
  }

  async replaceOpeningHours(
    context: AccountContext,
    placeId: string,
    body: ReplaceOpeningHoursDto,
  ): Result {
    return result(
      await this.catalog.placeAdmin.call(
        'replaceOpeningHours',
        toReplaceOpeningHoursRequest(placeId, body),
        context,
      ),
    );
  }

  async activate(context: AccountContext, placeId: string): Promise<ActivationResultResponseDto> {
    const response = await this.catalog.placeAdmin.call('requestActivation', { placeId }, context);
    return toActivationResultResponseDto(response);
  }

  async deactivate(context: AccountContext, placeId: string, reason: string): Result {
    return result(
      await this.catalog.placeAdmin.call('deactivatePlace', { placeId, reason }, context),
    );
  }

  async delete(context: AccountContext, placeId: string): Promise<void> {
    await this.catalog.placeAdmin.call('deletePlace', { placeId }, context);
  }

  async restore(context: AccountContext, placeId: string): Result {
    return result(await this.catalog.placeAdmin.call('restorePlace', { placeId }, context));
  }

  /** The sticker, encoding `PUBLIC_QR_BASE_URL/q/<code>`. */
  async qr(context: AccountContext, placeId: string): Promise<string> {
    const response = await this.catalog.placeAdmin.call(
      'getPlaceQr',
      { placeId, qrBaseUrl: this.qrBaseUrl },
      context,
    );
    return response.svg;
  }
}
