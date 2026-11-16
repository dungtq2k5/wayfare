import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { FavoritesService } from './favorites.service';

/** `wayfare.catalog.FavoriteService` — unpack the caller, delegate once. */
@Controller()
@catalogGrpc.FavoriteServiceControllerMethods()
export class FavoritesGrpcController implements catalogGrpc.FavoriteServiceController {
  constructor(private readonly favorites: FavoritesService) {}

  listFavorites(
    request: catalogGrpc.ListFavoritesRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ListFavoritesResponse> {
    return this.favorites.listFavorites(request, unpackCallerContext(metadata));
  }

  addFavorite(
    request: catalogGrpc.AddFavoriteRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.AddFavoriteResponse> {
    return this.favorites.addFavorite(request, unpackCallerContext(metadata));
  }

  removeFavorite(
    request: catalogGrpc.RemoveFavoriteRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.RemoveFavoriteResponse> {
    return this.favorites.removeFavorite(request, unpackCallerContext(metadata));
  }
}
