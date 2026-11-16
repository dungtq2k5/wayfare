import type { TourStatus, TranslationSource } from '@wayfare/contracts';
import { zPhotoVariants } from '@wayfare/contracts';
import { placeStatusProto, tourStatusProto, translationSourceProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { distanceMeters, TOUR_MIN_LIVE_STOPS } from '@wayfare/core';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import { toPhotoVariantViews, toPhotoView } from '../places/place.mapper';
import type { TourStopRow } from './domain/tour-stops';
import { isLiveStop } from './domain/tour-stops';

/** A list row as the admin query reads it. */
export interface AdminTourListRow {
  readonly id: string;
  readonly publicCode: string;
  readonly titleVi: string;
  readonly areaId: string;
  readonly areaCode: string;
  readonly status: TourStatus;
  readonly inactiveReason: string | null;
  readonly estimatedMinutes: number;
  readonly distanceM: number;
  readonly coverVariants: Prisma.JsonValue;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  readonly activationRequestedAt: Date | null;
  readonly totalStops: number;
  readonly liveStops: number;
}

const coverOf = (variants: Prisma.JsonValue, mediaBase: string) =>
  variants === null ? undefined : toPhotoView(zPhotoVariants.parse(variants).card, mediaBase);

export function toAdminTourListItem(
  row: AdminTourListRow,
  mediaBase: string,
): catalogGrpc.AdminTourListItem {
  return {
    id: row.id,
    publicCode: row.publicCode,
    titleVi: row.titleVi,
    areaId: row.areaId,
    areaCode: row.areaCode,
    status: tourStatusProto.toProto(row.status),
    inactiveByAdmin: row.inactiveReason !== null,
    estimatedMinutes: row.estimatedMinutes,
    distanceM: row.distanceM,
    liveStops: row.liveStops,
    totalStops: row.totalStops,
    hiddenFromTourists: row.liveStops < TOUR_MIN_LIVE_STOPS,
    cover: coverOf(row.coverVariants, mediaBase),
    updatedAt: toProtoTimestamp(row.updatedAt),
    deletedAt: row.deletedAt === null ? undefined : toProtoTimestamp(row.deletedAt),
    activationRequested: row.activationRequestedAt !== null,
  };
}

/** A tour's every column, its stops and translations, for the console. */
export function toAdminTour(
  tour: {
    readonly id: string;
    readonly publicCode: string;
    readonly areaId: string;
    readonly area: { readonly code: string };
    readonly titleVi: string;
    readonly descriptionVi: string;
    readonly contentHash: string;
    readonly estimatedMinutes: number;
    readonly distanceM: number;
    readonly coverVariants: Prisma.JsonValue;
    readonly status: string;
    readonly inactiveReason: string | null;
    readonly activationRequestedAt: Date | null;
    readonly syncVersion: bigint;
    readonly createdById: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly deletedAt: Date | null;
    readonly localizations: readonly {
      readonly lang: string;
      readonly sourceContentHash: string;
      readonly translationSource: string;
    }[];
  },
  stops: readonly TourStopRow[],
  missing: readonly string[],
  mediaBase: string,
): catalogGrpc.AdminTour {
  const liveStops = stops.filter((stop) => isLiveStop(stop, tour.areaId)).length;
  return {
    id: tour.id,
    publicCode: tour.publicCode,
    areaId: tour.areaId,
    areaCode: tour.area.code,
    titleVi: tour.titleVi,
    descriptionVi: tour.descriptionVi,
    contentHash: tour.contentHash,
    estimatedMinutes: tour.estimatedMinutes,
    distanceM: tour.distanceM,
    cover:
      tour.coverVariants === null ? undefined : toPhotoVariantViews(tour.coverVariants, mediaBase),
    status: tourStatusProto.toProto(tour.status as TourStatus),
    inactiveByAdmin: tour.inactiveReason !== null,
    activationRequestedAt:
      tour.activationRequestedAt === null
        ? undefined
        : toProtoTimestamp(tour.activationRequestedAt),
    syncVersion: tour.syncVersion.toString(),
    createdById: tour.createdById,
    createdAt: toProtoTimestamp(tour.createdAt),
    updatedAt: toProtoTimestamp(tour.updatedAt),
    deletedAt: tour.deletedAt === null ? undefined : toProtoTimestamp(tour.deletedAt),
    stops: stops.map((stop, index) => {
      const previous = stops[index - 1];
      return {
        position: stop.position,
        placeId: stop.placeId,
        publicCode: stop.publicCode,
        nameVi: stop.nameVi,
        ...(stop.nameEn === null ? {} : { nameEn: stop.nameEn }),
        categoryCode: stop.categoryCode,
        status: placeStatusProto.toProto(stop.status),
        deleted: stop.deleted,
        outsideArea: stop.areaId !== tour.areaId,
        location: { lat: stop.lat, lng: stop.lng },
        legM: previous === undefined ? 0 : distanceMeters(previous, stop),
      };
    }),
    localizations: [...tour.localizations]
      .sort((a, b) => a.lang.localeCompare(b.lang))
      .map((row) => ({
        lang: row.lang,
        textReady: true,
        stale: row.sourceContentHash !== tour.contentHash,
        translationSource: translationSourceProto.toProto(
          row.translationSource as TranslationSource,
        ),
      })),
    activationMissing: [...missing],
    liveStops,
    hiddenFromTourists: liveStops < TOUR_MIN_LIVE_STOPS,
  };
}
