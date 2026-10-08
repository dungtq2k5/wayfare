import type { OfflineAsset, PlaceSyncRecord, ProtoEnumBridge } from '@wayfare/contracts';
import { contentTierProto, placeKindProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';

/** A proto enum value catalog itself wrote; an unknown one is a bug here. */
function known<D extends string>(bridge: ProtoEnumBridge<D, number>, value: number): D {
  const member = bridge.fromProto(value);
  if (member === null) throw new Error(`unknown enum value ${value}`);
  return member;
}

/**
 * A snapshot line: the record `/sync/places` serves, in its REST shape — the device reads the
 * snapshot and a sync page with one parser.
 */
export function toPlaceSyncRecord(record: catalogGrpc.PlaceSyncRecord): PlaceSyncRecord {
  const localization = record.localization!;
  const audio = localization.audio;
  const photo = record.cardPhoto;
  return {
    id: record.id,
    kind: known(placeKindProto, record.kind),
    publicCode: record.publicCode,
    categoryCode: record.categoryCode,
    areaId: record.areaId,
    location: { lat: record.location!.lat, lng: record.location!.lng },
    triggerRadiusM: record.triggerRadiusM,
    narrationPriority: record.narrationPriority,
    autoNarrationEnabled: record.autoNarrationEnabled,
    addressVi: record.addressVi ?? null,
    localization: {
      lang: localization.lang,
      name: localization.name,
      description: localization.description,
      contentTier: known(contentTierProto, localization.contentTier),
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
    },
    cardPhoto:
      photo === undefined || photo === null
        ? null
        : {
            url: photo.url,
            sha256: photo.sha256,
            bytes: photo.bytes,
            width: photo.width,
            height: photo.height,
          },
    priceBand: record.priceBand ?? null,
    openingHours: record.openingHours.map((row) => ({
      ...(row.weekday === undefined ? {} : { weekday: row.weekday }),
      ...(row.specificDate === undefined ? {} : { specificDate: row.specificDate }),
      ...(row.opensAt === undefined ? {} : { opensAt: row.opensAt }),
      ...(row.closesAt === undefined ? {} : { closesAt: row.closesAt }),
      isClosed: row.isClosed,
    })),
  };
}

/** A served media object as an offline asset: its bucket path beside its URL. */
export function toOfflineAsset(
  object: { readonly url: string; readonly sha256: string; readonly bytes: number },
  mediaBase: string,
): OfflineAsset {
  const prefix = `${mediaBase}/`;
  if (!object.url.startsWith(prefix)) throw new Error(`${object.url} is not under ${prefix}`);
  return {
    path: object.url.slice(prefix.length),
    url: object.url,
    sha256: object.sha256,
    bytes: object.bytes,
  };
}
