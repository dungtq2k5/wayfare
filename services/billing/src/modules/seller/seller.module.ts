import { Module } from '@nestjs/common';
import { SellerGrpcController } from './seller-grpc.controller';
import { SellerService } from './seller.service';

/** A seller's live obligations (api-endpoints-plan §12.2). */
@Module({ controllers: [SellerGrpcController], providers: [SellerService] })
export class SellerModule {}
