// Catalog shapes for tests: the pilot geometry, RPC messages for stubbed peers in the gateway
// suites, and `narration.localization.ready` payloads for the gate (rdm-spec §1.6).
import { systemCategory } from '../catalog/categories';
import { newId } from '../common/ids';
import { LocalizationTargetType, TranslationSource } from '../narration/enums';
import type { GeoPoint } from '../catalog/schemas';
import {
  CategoryAppliesTo as ProtoCategoryAppliesTo,
  ContentTier as ProtoContentTier,
  MenuCurrency as ProtoMenuCurrency,
  PlaceKind as ProtoPlaceKind,
  PlaceStatus as ProtoPlaceStatus,
} from '../generated/wayfare/catalog/place_types.pb';
import type { PhotoVariantViews, PhotoView } from '../generated/wayfare/catalog/place_types.pb';
import type {
  Area,
  Category,
  PlaceDetail,
  PlaceSummary,
  PlaceSyncRecord,
} from '../generated/wayfare/catalog/place_query.pb';
import type { AdminPlace } from '../generated/wayfare/catalog/place_admin.pb';
import { FIXTURE_IDS } from './fixtures';
import { FIXTURE_TIMESTAMP } from './identity-rpc-fixtures';

/** Ids the catalog fixtures use. */
export const CATALOG_FIXTURE_IDS = {
  category: '01990000-0000-7000-8000-000000000020',
  area: '01990000-0000-7000-8000-000000000021',
  photo: '01990000-0000-7000-8000-000000000022',
  upload: '01990000-0000-7000-8000-000000000023',
} as const;

/** A public code the fixtures use. */
export const FIXTURE_PUBLIC_CODE = 'K7M2Q9XA';

/** A test area around Bến Thành, as `[lng, lat]` corners of a closed ring. */
export const FIXTURE_AREA_RING: readonly (readonly [number, number])[] = [
  [106.69, 10.765],
  [106.71, 10.765],
  [106.71, 10.78],
  [106.69, 10.78],
  [106.69, 10.765],
];

/** The test area as GeoJSON. */
export const FIXTURE_AREA_GEOJSON = JSON.stringify({
  type: 'Polygon',
  coordinates: [FIXTURE_AREA_RING],
});

/** A point inside the test area: Bến Thành Market. */
export const FIXTURE_INSIDE: GeoPoint = { lat: 10.7725, lng: 106.698 };

/** A point outside every test area: Thủ Đức. */
export const FIXTURE_OUTSIDE: GeoPoint = { lat: 10.85, lng: 106.77 };

const HEX = (char: string) => char.repeat(64);

/** A served photo variant. */
export function photoViewFixture(overrides: Partial<PhotoView> = {}): PhotoView {
  return {
    url: `https://media.example.com/photos/${CATALOG_FIXTURE_IDS.upload}/card.webp`,
    sha256: HEX('c'),
    bytes: 42_000,
    width: 800,
    height: 600,
    ...overrides,
  };
}

/** A photo's three variants. */
export function photoVariantViewsFixture(): PhotoVariantViews {
  return {
    thumb: photoViewFixture({ width: 320, height: 240 }),
    card: photoViewFixture(),
    full: photoViewFixture({ width: 1600, height: 1200 }),
  };
}

/** The seeded category the fixtures use (rdm-spec C-2). */
const MARKET = systemCategory('MARKET')!;

/** A category as `ListCategories` returns it. */
export function categoryFixture(overrides: Partial<Category> = {}): Category {
  return {
    id: CATALOG_FIXTURE_IDS.category,
    code: MARKET.code,
    appliesTo: ProtoCategoryAppliesTo.CATEGORY_APPLIES_TO_ANY,
    icon: MARKET.icon,
    sortOrder: MARKET.sortOrder,
    ...overrides,
  };
}

/** An area as `ListAreas` returns it. */
export function areaFixture(overrides: Partial<Area> = {}): Area {
  return {
    id: CATALOG_FIXTURE_IDS.area,
    code: 'hcmc-d1-core',
    nameVi: 'Quận 1',
    boundaryGeojson: FIXTURE_AREA_GEOJSON,
    center: { lat: 10.7725, lng: 106.7 },
    defaultZoom: 15,
    sortOrder: 0,
    datasetVersion: '42',
    ...overrides,
  };
}

const localization = {
  lang: 'en',
  name: 'Ben Thanh Market',
  description: 'A market since 1914.',
  contentTier: ProtoContentTier.CONTENT_TIER_REQUESTED,
  stale: false,
  audio: {
    url: `https://media.example.com/audio/${HEX('a')}.mp3`,
    sha256: HEX('b'),
    bytes: 48_000,
    durationMs: 31_000,
  },
};

/** A synced Place as `SyncPlaces` returns it. */
export function placeSyncRecordFixture(overrides: Partial<PlaceSyncRecord> = {}): PlaceSyncRecord {
  return {
    id: FIXTURE_IDS.place,
    kind: ProtoPlaceKind.PLACE_KIND_EDITORIAL,
    publicCode: FIXTURE_PUBLIC_CODE,
    categoryCode: 'MARKET',
    areaId: CATALOG_FIXTURE_IDS.area,
    location: FIXTURE_INSIDE,
    triggerRadiusM: 30,
    narrationPriority: 50,
    autoNarrationEnabled: true,
    localization,
    cardPhoto: photoViewFixture(),
    priceBand: undefined,
    openingHours: [{ weekday: 1, opensAt: '06:00', closesAt: '18:00', isClosed: false }],
    ...overrides,
  };
}

/** A nearby result as `NearbyPlaces` returns it. */
export function placeSummaryFixture(overrides: Partial<PlaceSummary> = {}): PlaceSummary {
  return {
    id: FIXTURE_IDS.place,
    kind: ProtoPlaceKind.PLACE_KIND_EDITORIAL,
    publicCode: FIXTURE_PUBLIC_CODE,
    categoryCode: 'MARKET',
    location: FIXTURE_INSIDE,
    name: 'Ben Thanh Market',
    lang: 'en',
    contentTier: ProtoContentTier.CONTENT_TIER_REQUESTED,
    stale: false,
    cardPhoto: photoViewFixture(),
    priceBand: undefined,
    distanceM: 120,
    walkingEtaMinutes: 3,
    sponsored: false,
    ...overrides,
  };
}

/** A Place detail as `GetPlace` returns it. */
export function placeDetailFixture(overrides: Partial<PlaceDetail> = {}): PlaceDetail {
  return {
    id: FIXTURE_IDS.place,
    kind: ProtoPlaceKind.PLACE_KIND_EDITORIAL,
    publicCode: FIXTURE_PUBLIC_CODE,
    categoryCode: 'MARKET',
    areaId: CATALOG_FIXTURE_IDS.area,
    location: FIXTURE_INSIDE,
    address: 'Lê Lợi, Bến Thành, Quận 1',
    triggerRadiusM: 30,
    narrationPriority: 50,
    autoNarrationEnabled: true,
    localization,
    photos: [
      { id: CATALOG_FIXTURE_IDS.photo, altText: 'Chợ', variants: photoVariantViewsFixture() },
    ],
    menu: undefined,
    openingHours: [],
    priceBand: undefined,
    phone: undefined,
    websiteUrl: undefined,
    syncVersion: '42',
    ...overrides,
  };
}

/** A Place as `PlaceAdminService` returns it. */
export function adminPlaceFixture(overrides: Partial<AdminPlace> = {}): AdminPlace {
  return {
    id: FIXTURE_IDS.place,
    kind: ProtoPlaceKind.PLACE_KIND_EDITORIAL,
    publicCode: FIXTURE_PUBLIC_CODE,
    ownerUserId: undefined,
    categoryCode: 'MARKET',
    areaId: CATALOG_FIXTURE_IDS.area,
    areaCode: 'hcmc-d1-core',
    nameVi: 'Chợ Bến Thành',
    descriptionVi: 'Chợ có từ năm 1914.',
    contentHash: HEX('a'),
    location: FIXTURE_INSIDE,
    addressVi: undefined,
    triggerRadiusM: 30,
    narrationPriority: 50,
    autoNarrationEnabled: true,
    discoveryBoost: 0,
    priceBand: undefined,
    menuCurrency: ProtoMenuCurrency.MENU_CURRENCY_VND,
    phone: undefined,
    websiteUrl: undefined,
    status: ProtoPlaceStatus.PLACE_STATUS_PROCESSING,
    inactiveReason: undefined,
    activationRequestedAt: FIXTURE_TIMESTAMP,
    publishedAt: undefined,
    syncVersion: '42',
    createdById: FIXTURE_IDS.user,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    deletedAt: undefined,
    deletedById: undefined,
    localizations: [],
    photos: [],
    menuItems: [],
    openingHours: [],
    activationMissing: ['en.text', 'en.audio'],
    ...overrides,
  };
}

/** What a `narration.localization.ready` fixture is about. */
export interface LocalizationReadyFixtureInput {
  readonly placeId: string;
  readonly lang: string;
  readonly sourceContentHash: string;
  readonly name?: string;
  readonly description?: string;
  /** Audio for this hash, or none (text only). Defaults to audio for `sourceContentHash`. */
  readonly audioContentHash?: string | null;
}

/**
 * A complete `narration.localization.ready` payload for a Place, shaped like narration's own:
 * a fresh event id, machine text (`SOURCE` for `vi`), and content-addressed audio.
 */
export function localizationReadyFixture(input: LocalizationReadyFixtureInput) {
  const audioHash =
    input.audioContentHash === undefined ? input.sourceContentHash : input.audioContentHash;
  return {
    eventId: newId(),
    occurredAt: new Date().toISOString(),
    targetType: LocalizationTargetType.PLACE,
    targetId: input.placeId,
    lang: input.lang,
    sourceContentHash: input.sourceContentHash,
    translationSource: input.lang === 'vi' ? TranslationSource.SOURCE : TranslationSource.MACHINE,
    text: {
      name: input.name ?? `Place (${input.lang})`,
      description: input.description ?? `A description in ${input.lang}.`,
    },
    ...(audioHash === null
      ? {}
      : {
          audio: {
            assetId: newId(),
            objectPath: `audio/${audioHash.slice(0, 16)}-${input.lang}.mp3`,
            sha256: HEX('d'),
            bytes: 48_000,
            durationMs: 31_000,
            voiceId: `${input.lang}-standard-a`,
            sourceContentHash: audioHash,
          },
        }),
  };
}
