import { Injectable } from '@nestjs/common';
import { Paged } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import type { FavoriteResponseDto } from './dto/favorite-response.dto';
import type { FavoritesQueryDto } from './dto/favorite.dto';
import { toFavorite } from './favorite.mapper';

/** `/me/favorites`, backed by `catalog.FavoriteService`. */
@Injectable()
export class FavoritesService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  async list(
    context: RequestContext,
    query: FavoritesQueryDto,
  ): Promise<Paged<FavoriteResponseDto>> {
    const response = await this.catalog.favorites.call(
      'listFavorites',
      { page: { cursor: query.cursor, limit: query.limit }, lang: query.lang.tag },
      context,
    );
    return Paged.cursor(response.favorites.map(toFavorite), response.page?.nextCursor ?? null);
  }

  async add(context: RequestContext, placeId: string): Promise<void> {
    await this.catalog.favorites.call('addFavorite', { placeId }, context);
  }

  async remove(context: RequestContext, placeId: string): Promise<void> {
    await this.catalog.favorites.call('removeFavorite', { placeId }, context);
  }
}
