import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { GrpcServiceCaller } from '@wayfare/nest-common';

/** Injection token for catalog's gRPC connection. */
export const CATALOG_GRPC = Symbol('CATALOG_GRPC');

/**
 * catalog as the gateway calls it: one caller per stub (conventions §6.2). Returns proto types
 * only; the deadline, caller metadata and down-versus-slow mapping live in each caller.
 */
@Injectable()
export class CatalogServiceGrpcClient implements OnModuleInit {
  readonly placeQueries: GrpcServiceCaller<catalogGrpc.PlaceQueryServiceClient>;
  readonly placeAdmin: GrpcServiceCaller<catalogGrpc.PlaceAdminServiceClient>;
  readonly uploads: GrpcServiceCaller<catalogGrpc.UploadServiceClient>;
  readonly ownerPlaces: GrpcServiceCaller<catalogGrpc.OwnerPlaceServiceClient>;
  readonly submissions: GrpcServiceCaller<catalogGrpc.SubmissionServiceClient>;
  readonly submissionReview: GrpcServiceCaller<catalogGrpc.SubmissionReviewServiceClient>;
  readonly taxonomyAdmin: GrpcServiceCaller<catalogGrpc.TaxonomyAdminServiceClient>;
  readonly mapPackAdmin: GrpcServiceCaller<catalogGrpc.MapPackAdminServiceClient>;
  readonly offline: GrpcServiceCaller<catalogGrpc.OfflineServiceClient>;
  readonly favorites: GrpcServiceCaller<catalogGrpc.FavoriteServiceClient>;

  constructor(@Inject(CATALOG_GRPC) grpc: ClientGrpc) {
    this.placeQueries = new GrpcServiceCaller(grpc, catalogGrpc.PLACE_QUERY_SERVICE_NAME);
    this.placeAdmin = new GrpcServiceCaller(grpc, catalogGrpc.PLACE_ADMIN_SERVICE_NAME);
    this.uploads = new GrpcServiceCaller(grpc, catalogGrpc.UPLOAD_SERVICE_NAME);
    this.ownerPlaces = new GrpcServiceCaller(grpc, catalogGrpc.OWNER_PLACE_SERVICE_NAME);
    this.submissions = new GrpcServiceCaller(grpc, catalogGrpc.SUBMISSION_SERVICE_NAME);
    this.submissionReview = new GrpcServiceCaller(grpc, catalogGrpc.SUBMISSION_REVIEW_SERVICE_NAME);
    this.taxonomyAdmin = new GrpcServiceCaller(grpc, catalogGrpc.TAXONOMY_ADMIN_SERVICE_NAME);
    this.mapPackAdmin = new GrpcServiceCaller(grpc, catalogGrpc.MAP_PACK_ADMIN_SERVICE_NAME);
    this.offline = new GrpcServiceCaller(grpc, catalogGrpc.OFFLINE_SERVICE_NAME);
    this.favorites = new GrpcServiceCaller(grpc, catalogGrpc.FAVORITE_SERVICE_NAME);
  }

  onModuleInit(): void {
    this.placeQueries.init();
    this.placeAdmin.init();
    this.uploads.init();
    this.ownerPlaces.init();
    this.submissions.init();
    this.submissionReview.init();
    this.taxonomyAdmin.init();
    this.mapPackAdmin.init();
    this.offline.init();
    this.favorites.init();
  }
}
