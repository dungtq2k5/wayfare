import type { catalogGrpc } from '@wayfare/contracts/grpc';

/** One row of the owner's Venue list, from catalog's view of the Venue (api-endpoints-plan §3.1). */
export function toOwnerPlace(
  place: catalogGrpc.AdminPlace,
  pending: catalogGrpc.Submission | undefined,
): catalogGrpc.OwnerPlace {
  const cover = place.photos.toSorted((a, b) => a.sortOrder - b.sortOrder)[0];
  return {
    id: place.id,
    publicCode: place.publicCode,
    nameVi: place.nameVi,
    categoryCode: place.categoryCode,
    status: place.status,
    inactiveReason: place.inactiveReason,
    autoNarration: place.autoNarrationEnabled,
    cover: cover?.variants?.thumb,
    localizations: place.localizations,
    pendingSubmission:
      pending === undefined
        ? undefined
        : { id: pending.id, kind: pending.kind, submittedAt: pending.submittedAt },
    updatedAt: place.updatedAt,
  };
}
