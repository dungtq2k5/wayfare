/**
 * The area a code's Place asks for: unchanged when it is already in view (or has none); otherwise the
 * Place's area becomes the Map's, with its name for the one toast that says so (Q14).
 */
export function areaMove(
  currentAreaId: string | null,
  placeAreaId: string | null,
): { readonly areaId: string } | null {
  if (placeAreaId === null || placeAreaId === currentAreaId) return null;
  return { areaId: placeAreaId };
}
