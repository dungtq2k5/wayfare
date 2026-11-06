import type { ProtoEnumBridge } from '@wayfare/contracts';
import { placeStatusProto, tourStatusProto, translationSourceProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { fromOptionalProtoTimestamp, fromProtoTimestamp } from '@wayfare/nest-common';
import { toGeoPoint, toPhotoView } from '../catalog/catalog.mapper';
import type {
  AdminTourListItemResponseDto,
  AdminTourResponseDto,
  TourActivationResultResponseDto,
} from './dto/admin-tour-response.dto';
import type { CreateTourDto, ListToursQueryDto, UpdateTourDto } from './dto/admin-tour.dto';

type GateMissing = TourActivationResultResponseDto['missing'][number];
const GATE_MISSING: readonly string[] = ['en.text', 'activation'];

function known<D extends string>(
  bridge: ProtoEnumBridge<D, number>,
  value: number | undefined,
  field: string,
): D {
  const member = bridge.fromProto(value);
  if (member === null) throw new Error(`catalog sent an unknown ${field}: ${String(value)}`);
  return member;
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

const gateMissing = (values: readonly string[]): GateMissing[] =>
  values.filter((value): value is GateMissing => GATE_MISSING.includes(value));

/** A list row. */
export function toAdminTourListItemResponseDto(
  row: catalogGrpc.AdminTourListItem,
): AdminTourListItemResponseDto {
  return {
    id: row.id,
    publicCode: row.publicCode,
    titleVi: row.titleVi,
    areaId: row.areaId,
    areaCode: row.areaCode,
    status: known(tourStatusProto, row.status, 'status'),
    inactiveByAdmin: row.inactiveByAdmin,
    activationRequested: row.activationRequested,
    estimatedMinutes: row.estimatedMinutes,
    distanceM: row.distanceM,
    liveStops: row.liveStops,
    totalStops: row.totalStops,
    hiddenFromTourists: row.hiddenFromTourists,
    cover: row.cover === undefined || row.cover === null ? null : toPhotoView(row.cover),
    updatedAt: fromProtoTimestamp(row.updatedAt, 'updatedAt').toISOString(),
    deletedAt: iso(fromOptionalProtoTimestamp(row.deletedAt, 'deletedAt')),
  };
}

/** A tour in full. */
export function toAdminTourResponseDto(
  tour: catalogGrpc.AdminTour | undefined | null,
): AdminTourResponseDto {
  if (tour === undefined || tour === null) throw new Error('A response arrived without its tour');
  return {
    id: tour.id,
    publicCode: tour.publicCode,
    areaId: tour.areaId,
    areaCode: tour.areaCode,
    titleVi: tour.titleVi,
    descriptionVi: tour.descriptionVi,
    contentHash: tour.contentHash,
    estimatedMinutes: tour.estimatedMinutes,
    distanceM: tour.distanceM,
    cover:
      tour.cover === undefined || tour.cover === null
        ? null
        : {
            thumb: toPhotoView(tour.cover.thumb),
            card: toPhotoView(tour.cover.card),
            full: toPhotoView(tour.cover.full),
          },
    status: known(tourStatusProto, tour.status, 'status'),
    inactiveByAdmin: tour.inactiveByAdmin,
    activationRequestedAt: iso(
      fromOptionalProtoTimestamp(tour.activationRequestedAt, 'activationRequestedAt'),
    ),
    syncVersion: tour.syncVersion,
    createdById: tour.createdById,
    createdAt: fromProtoTimestamp(tour.createdAt, 'createdAt').toISOString(),
    updatedAt: fromProtoTimestamp(tour.updatedAt, 'updatedAt').toISOString(),
    deletedAt: iso(fromOptionalProtoTimestamp(tour.deletedAt, 'deletedAt')),
    stops: tour.stops.map((stop) => ({
      position: stop.position,
      placeId: stop.placeId,
      publicCode: stop.publicCode,
      nameVi: stop.nameVi,
      nameEn: stop.nameEn ?? null,
      categoryCode: stop.categoryCode,
      status: known(placeStatusProto, stop.status, 'stop status'),
      deleted: stop.deleted,
      outsideArea: stop.outsideArea,
      location: toGeoPoint(stop.location),
      legM: stop.legM,
    })),
    localizations: tour.localizations.map((row) => ({
      lang: row.lang,
      textReady: row.textReady,
      stale: row.stale,
      translationSource: known(translationSourceProto, row.translationSource, 'translationSource'),
    })),
    activationMissing: gateMissing(tour.activationMissing),
    liveStops: tour.liveStops,
    hiddenFromTourists: tour.hiddenFromTourists,
  };
}

export function toTourActivationResultResponseDto(
  response: catalogGrpc.RequestTourActivationResponse,
): TourActivationResultResponseDto {
  return {
    status: known(tourStatusProto, response.status, 'status'),
    missing: gateMissing(response.missing),
  };
}

export function toTourAdminServiceListToursRequest(
  query: ListToursQueryDto,
): catalogGrpc.TourAdminServiceListToursRequest {
  return {
    page: {
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      ...(query.q === undefined ? {} : { q: query.q }),
    },
    ...(query.status === undefined ? {} : { status: tourStatusProto.toProto(query.status) }),
    ...(query.areaId === undefined ? {} : { areaId: query.areaId }),
    includeDeleted: query.includeDeleted ?? false,
  };
}

export function toCreateTourRequest(body: CreateTourDto): catalogGrpc.CreateTourRequest {
  return {
    titleVi: body.titleVi,
    descriptionVi: body.descriptionVi,
    areaId: body.areaId,
    estimatedMinutes: body.estimatedMinutes,
    ...(body.coverUploadId === undefined ? {} : { coverUploadId: body.coverUploadId }),
    placeIds: body.stops,
    requestActivation: body.requestActivation,
  };
}

export function toUpdateTourRequest(
  tourId: string,
  body: UpdateTourDto,
): catalogGrpc.UpdateTourRequest {
  return {
    tourId,
    ...(body.titleVi === undefined ? {} : { titleVi: body.titleVi }),
    ...(body.descriptionVi === undefined ? {} : { descriptionVi: body.descriptionVi }),
    ...(body.estimatedMinutes === undefined ? {} : { estimatedMinutes: body.estimatedMinutes }),
    ...(body.coverUploadId == null ? {} : { coverUploadId: body.coverUploadId }),
    removeCover: body.coverUploadId === null,
  };
}
