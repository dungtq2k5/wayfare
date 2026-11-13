import type { TourDetail, TourSummary, TourSyncRecord, TourText } from '@wayfare/contracts';
import { contentTierProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { toGeoPoint, toPhotoView } from '../catalog/catalog.mapper';

function toTourText(text: catalogGrpc.TourText | undefined): TourText {
  if (text === undefined || text === null) throw new Error('catalog sent a tour without its text');
  const tier = contentTierProto.fromProto(text.contentTier);
  if (tier === null) throw new Error(`catalog sent an unknown content tier: ${text.contentTier}`);
  return {
    lang: text.lang as TourText['lang'],
    title: text.title,
    description: text.description,
    contentTier: tier,
    stale: text.stale,
  };
}

/** A tour as a list shows it. */
export function toTourSummary(summary: catalogGrpc.TourSummary | undefined): TourSummary {
  if (summary === undefined || summary === null)
    throw new Error('catalog sent a tour without its summary');
  return {
    id: summary.id,
    publicCode: summary.publicCode,
    areaId: summary.areaId,
    areaCode: summary.areaCode,
    text: toTourText(summary.text),
    cover:
      summary.cover === undefined || summary.cover === null ? null : toPhotoView(summary.cover),
    estimatedMinutes: summary.estimatedMinutes,
    distanceM: summary.distanceM,
    stopCount: summary.stopCount,
  };
}

/** A tour's page: its stops at their positions, a gap without its Place. */
export function toTourDetail(detail: catalogGrpc.TourDetail | undefined): TourDetail {
  if (detail === undefined || detail === null)
    throw new Error('A response arrived without its tour');
  return {
    ...toTourSummary(detail.summary),
    coverVariants:
      detail.cover === undefined || detail.cover === null
        ? null
        : {
            thumb: toPhotoView(detail.cover.thumb),
            card: toPhotoView(detail.cover.card),
            full: toPhotoView(detail.cover.full),
          },
    stops: detail.stops.map((stop) => ({
      position: stop.position,
      legM: stop.legM,
      place:
        stop.place === undefined || stop.place === null
          ? null
          : {
              id: stop.place.id,
              publicCode: stop.place.publicCode,
              categoryCode: stop.place.categoryCode,
              location: toGeoPoint(stop.place.location),
              name: stop.place.name,
              nameVi: stop.place.nameVi,
              cardPhoto:
                stop.place.cardPhoto === undefined || stop.place.cardPhoto === null
                  ? null
                  : toPhotoView(stop.place.cardPhoto),
            },
    })),
  };
}

/** One synced tour. */
export function toTourSyncRecord(record: catalogGrpc.TourSyncRecord): TourSyncRecord {
  return {
    id: record.id,
    publicCode: record.publicCode,
    areaId: record.areaId,
    text: toTourText(record.text),
    cover: record.cover === undefined || record.cover === null ? null : toPhotoView(record.cover),
    estimatedMinutes: record.estimatedMinutes,
    distanceM: record.distanceM,
    stops: record.stops.map((stop) => ({ position: stop.position, placeId: stop.placeId })),
  };
}
