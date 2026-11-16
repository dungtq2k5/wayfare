import type { adminPlacesGet } from '@wayfare/api-client';

/** A Place as its staff page reads it (`GET /admin/places/:id`). */
export type PlaceDetail = Awaited<ReturnType<typeof adminPlacesGet>>['data'];
