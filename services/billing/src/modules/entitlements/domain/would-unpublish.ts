import type { Entitlements } from '@wayfare/contracts';
import type { CatalogServiceGrpcClient } from '../../catalog/catalog-service-grpc.client';

/**
 * The owner's Places a new `max_places` would take off the map: a plan's apply and an unpin's
 * preview say the same number. Null when catalog cannot count.
 */
export async function wouldUnpublish(
  catalog: CatalogServiceGrpcClient,
  ownerUserId: string,
  next: Entitlements,
): Promise<number | null> {
  const places = await catalog.countOwnerPlaces(ownerUserId);
  return places === null ? null : Math.max(0, places - next.maxPlaces);
}
