/** The Places list's filters (L1, K27): each one a URL parameter, so a filtered list is a link. */
export interface PlaceFilters {
  readonly q: string;
  /** A Place status, or `STUCK`: K26's derived one. */
  readonly status: string | null;
  readonly kind: string | null;
  readonly areaId: string | null;
  readonly categoryCode: string | null;
  /** Set from a link (U2's *Venues*); shown as a chip, not a menu. */
  readonly ownerUserId: string | null;
  readonly includeDeleted: boolean;
}

const KEYS = ['status', 'kind', 'areaId', 'categoryCode', 'ownerUserId'] as const;

/** The filters a URL's query names; anything it doesn't is unset. */
export function filtersFrom(params: URLSearchParams): PlaceFilters {
  const value = (key: string) => {
    const raw = params.get(key);
    return raw === null || raw === '' ? null : raw;
  };
  return {
    q: params.get('q') ?? '',
    status: value('status'),
    kind: value('kind'),
    areaId: value('areaId'),
    categoryCode: value('categoryCode'),
    ownerUserId: value('ownerUserId'),
    includeDeleted: params.get('includeDeleted') === 'true',
  };
}

/** The query that holds the filters: set ones only, in a fixed order. */
export function queryOf(filters: PlaceFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim() !== '') params.set('q', filters.q);
  for (const key of KEYS) {
    const value = filters[key];
    if (value !== null) params.set(key, value);
  }
  if (filters.includeDeleted) params.set('includeDeleted', 'true');
  return params.toString();
}
