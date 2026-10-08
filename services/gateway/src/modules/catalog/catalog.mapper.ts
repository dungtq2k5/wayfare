import type {
  GeoPoint,
  OpeningHoursRow,
  PhotoView,
  PlaceLocalization,
  PlaceSummary,
  PlaceSyncRecord,
  ProtoEnumBridge,
} from '@wayfare/contracts';
import { contentTierProto, placeKindProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc, geoGrpc } from '@wayfare/contracts/grpc';

/** A proto enum the gateway must understand; an unknown value is a peer newer than us. */
function known<D extends string>(
  bridge: ProtoEnumBridge<D, number>,
  value: number,
  field: string,
): D {
  const member = bridge.fromProto(value);
  if (member === null) throw new Error(`catalog sent an unknown ${field}: ${value}`);
  return member;
}

/** A point; an absent one is a broken response. */
export function toGeoPoint(point: geoGrpc.GeoPoint | undefined | null): GeoPoint {
  if (point === undefined || point === null)
    throw new Error('A response arrived without its point');
  return { lat: point.lat, lng: point.lng };
}

/** A served photo variant. */
export function toPhotoView(photo: catalogGrpc.PhotoView | undefined | null): PhotoView {
  if (photo === undefined || photo === null)
    throw new Error('A response arrived without its photo');
  return {
    url: photo.url,
    sha256: photo.sha256,
    bytes: photo.bytes,
    width: photo.width,
    height: photo.height,
  };
}

/** A record's localized text, with its tier; audio only when catalog served it. */
export function toPlaceLocalization(
  localization: catalogGrpc.PlaceLocalization | undefined | null,
): PlaceLocalization {
  if (localization === undefined || localization === null) {
    throw new Error('A response arrived without its localization');
  }
  const audio = localization.audio;
  return {
    lang: localization.lang,
    name: localization.name,
    description: localization.description,
    contentTier: known(contentTierProto, localization.contentTier, 'contentTier'),
    stale: localization.stale,
    audio:
      audio === undefined || audio === null
        ? null
        : {
            url: audio.url,
            sha256: audio.sha256,
            bytes: audio.bytes,
            durationMs: audio.durationMs,
          },
  };
}

/** An opening-hours row; absent parts are left out, as the shared schema reads them. */
export function toOpeningHoursRow(row: catalogGrpc.OpeningHoursRow): OpeningHoursRow {
  return {
    ...(row.weekday === undefined ? {} : { weekday: row.weekday }),
    ...(row.specificDate === undefined ? {} : { specificDate: row.specificDate }),
    ...(row.opensAt === undefined ? {} : { opensAt: row.opensAt }),
    ...(row.closesAt === undefined ? {} : { closesAt: row.closesAt }),
    isClosed: row.isClosed,
  };
}

/** What the offline engine holds per Place. */
export function toPlaceSyncRecord(record: catalogGrpc.PlaceSyncRecord): PlaceSyncRecord {
  return {
    id: record.id,
    kind: known(placeKindProto, record.kind, 'kind'),
    publicCode: record.publicCode,
    categoryCode: record.categoryCode,
    areaId: record.areaId,
    location: toGeoPoint(record.location),
    triggerRadiusM: record.triggerRadiusM,
    narrationPriority: record.narrationPriority,
    autoNarrationEnabled: record.autoNarrationEnabled,
    addressVi: record.addressVi ?? null,
    localization: toPlaceLocalization(record.localization),
    cardPhoto:
      record.cardPhoto === undefined || record.cardPhoto === null
        ? null
        : toPhotoView(record.cardPhoto),
    priceBand: record.priceBand ?? null,
    openingHours: record.openingHours.map(toOpeningHoursRow),
  };
}

/** One nearby result. */
export function toPlaceSummary(summary: catalogGrpc.PlaceSummary): PlaceSummary {
  return {
    id: summary.id,
    kind: known(placeKindProto, summary.kind, 'kind'),
    publicCode: summary.publicCode,
    categoryCode: summary.categoryCode,
    location: toGeoPoint(summary.location),
    name: summary.name,
    lang: summary.lang,
    contentTier: known(contentTierProto, summary.contentTier, 'contentTier'),
    stale: summary.stale,
    cardPhoto:
      summary.cardPhoto === undefined || summary.cardPhoto === null
        ? null
        : toPhotoView(summary.cardPhoto),
    priceBand: summary.priceBand ?? null,
    distanceM: summary.distanceM,
    walkingEtaMinutes: summary.walkingEtaMinutes,
    sponsored: summary.sponsored,
  };
}
