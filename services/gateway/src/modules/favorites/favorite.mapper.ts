import type { Favorite } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { fromProtoTimestamp } from '@wayfare/nest-common';
import { toPlaceSummary } from '../catalog/catalog.mapper';

/** A saved Place; its summary has no origin, so no distance, walking time or `sponsored`. */
export function toFavorite(favorite: catalogGrpc.Favorite): Favorite {
  if (favorite.place === undefined || favorite.place === null) {
    throw new Error('catalog sent a favourite without its Place');
  }
  const {
    distanceM: _distance,
    walkingEtaMinutes: _eta,
    sponsored: _sponsored,
    ...place
  } = toPlaceSummary(favorite.place);
  return {
    placeId: favorite.placeId,
    savedAt: fromProtoTimestamp(favorite.savedAt, 'savedAt').toISOString(),
    place,
  };
}
