import { MAX_AREA_VERTICES, zAreaPolygon } from '@wayfare/contracts';
import { edgesCross, openRing } from '@wayfare/ui/boundary-model';
import type { Vertex } from '@wayfare/ui/boundary-model';

/** Why a pasted boundary was refused (A3b), each with its own line. */
export type PasteError = 'notPolygon' | 'tooMany' | 'crossing';

/**
 * A pasted boundary (A3b), checked before the dialog closes: one GeoJSON polygon — bare, or as a
 * Feature — with the contract's boundary schema, and crossing edges, which the schema doesn't
 * check (catalog's `ST_IsValid` still refuses them on save).
 */
export function parseBoundary(text: string): { points: Vertex[] } | { error: PasteError } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'notPolygon' };
  }
  const geometry =
    (value as { type?: unknown } | null)?.type === 'Feature'
      ? (value as { geometry?: unknown }).geometry
      : value;
  const ring = (geometry as { coordinates?: unknown[] } | null)?.coordinates?.[0];
  if (Array.isArray(ring) && ring.length > MAX_AREA_VERTICES + 1) return { error: 'tooMany' };
  const parsed = zAreaPolygon.safeParse(geometry);
  if (!parsed.success) return { error: 'notPolygon' };
  const points = openRing(parsed.data.coordinates[0]);
  return edgesCross(points) ? { error: 'crossing' } : { points };
}
