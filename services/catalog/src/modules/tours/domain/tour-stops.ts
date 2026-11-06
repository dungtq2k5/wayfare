import { PlaceStatus } from '@wayfare/contracts';
import type { CatalogTx } from '../../sync/sync.service';

/** One stop as staff see it: whatever its Place became. */
export interface TourStopRow {
  readonly position: number;
  readonly placeId: string;
  readonly publicCode: string;
  readonly nameVi: string;
  readonly nameEn: string | null;
  readonly categoryCode: string;
  readonly status: PlaceStatus;
  readonly deleted: boolean;
  readonly areaId: string;
  readonly lat: number;
  readonly lng: number;
}

/** A tour's stops in order, with their Places as they stand now. */
export async function readTourStops(db: CatalogTx, tourId: string): Promise<TourStopRow[]> {
  return db.$queryRaw<TourStopRow[]>`
    SELECT s.position, s.place_id AS "placeId", p.public_code AS "publicCode",
           p.name_vi AS "nameVi", en.name AS "nameEn", c.code AS "categoryCode", p.status,
           p.deleted_at IS NOT NULL AS deleted, p.area_id AS "areaId",
           ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng
    FROM tour_stops s
    JOIN places p ON p.id = s.place_id
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN place_localizations en ON en.place_id = p.id AND en.lang = 'en'
    WHERE s.tour_id = ${tourId}::uuid
    ORDER BY s.position`;
}

/** A stop a tourist sees: its Place live, not deleted, and still in the tour's area. */
export const isLiveStop = (stop: TourStopRow, areaId: string): boolean =>
  stop.status === PlaceStatus.ACTIVE && !stop.deleted && stop.areaId === areaId;
