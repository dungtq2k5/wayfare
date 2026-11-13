import { Module } from '@nestjs/common';
import { PlaceQueriesModule } from '../place-queries/place-queries.module';
import { FavoritesGrpcController } from './favorites-grpc.controller';
import { FavoritesService } from './favorites.service';

/** A device's saved Places (api-endpoints-plan §2.3, rdm-spec C-13). */
@Module({
  imports: [PlaceQueriesModule],
  controllers: [FavoritesGrpcController],
  providers: [FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
