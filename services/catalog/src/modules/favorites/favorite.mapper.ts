import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';

/** A saved Place: when it was first saved, and its summary in the caller's language. */
export function toFavorite(
  row: { readonly placeId: string; readonly savedAt: Date },
  place: catalogGrpc.PlaceSummary,
): catalogGrpc.Favorite {
  return { placeId: row.placeId, savedAt: toProtoTimestamp(row.savedAt), place };
}
