import {
  AudioStatus,
  MenuCurrency,
  PlaceInactiveReason,
  PlaceKind,
  PlaceStatus,
  SynthesisJobStatus,
  TranslationSource,
} from '@wayfare/contracts';
import {
  audioStatusProto,
  menuCurrencyProto,
  placeInactiveReasonProto,
  placeKindProto,
  placeStatusProto,
  synthesisJobStatusProto,
  translationSourceProto,
} from '@wayfare/contracts/grpc';
import type { catalogGrpc, narrationGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import {
  toActivationResultResponseDto,
  toAdminPlaceListItemResponseDto,
  toAdminPlaceResponseDto,
  toCreateEditorialPlaceRequest,
  toListPlacesRequest,
  toReplaceMenuRequest,
  toReplaceOpeningHoursRequest,
  toReplacePhotosRequest,
  toStuckPlaceResponseDto,
  toUpdatePlaceRequest,
} from './admin-place.mapper';
import type {
  CreatePlaceDto,
  ListPlacesQueryDto,
  ReplaceMenuDto,
  ReplacePhotosDto,
} from './dto/admin-place.dto';

const at = (iso: string) => toProtoTimestamp(new Date(iso));
const photoView = (url: string) => ({ url, sha256: 'h', bytes: 1, width: 2, height: 3 });

/** A Place with every optional field absent. */
const bare = {
  id: 'p1',
  kind: placeKindProto.toProto(PlaceKind.VENUE),
  publicCode: 'K7M2Q9XA',
  categoryCode: 'CAFE',
  areaId: 'a1',
  areaCode: 'd1',
  nameVi: 'Quán',
  descriptionVi: 'Mô tả',
  contentHash: 'c',
  location: { lat: 10.77, lng: 106.7 },
  triggerRadiusM: 30,
  narrationPriority: 50,
  autoNarrationEnabled: false,
  discoveryBoost: 0,
  menuCurrency: menuCurrencyProto.toProto(MenuCurrency.VND),
  status: placeStatusProto.toProto(PlaceStatus.DRAFT),
  syncVersion: 4,
  createdById: 'u1',
  createdAt: at('2026-10-01T00:00:00Z'),
  updatedAt: at('2026-10-02T00:00:00Z'),
  statusChangedAt: at('2026-10-03T00:00:00Z'),
  localizations: [],
  photos: [],
  menuItems: [],
  openingHours: [],
  activationMissing: [],
} as unknown as catalogGrpc.AdminPlace;

describe('a Place in full, for the console', () => {
  it('turns every absent optional into null', () => {
    expect(toAdminPlaceResponseDto(bare)).toMatchObject({
      kind: PlaceKind.VENUE,
      ownerUserId: null,
      addressVi: null,
      priceBand: null,
      phone: null,
      websiteUrl: null,
      inactiveReason: null,
      activationRequestedAt: null,
      publishedAt: null,
      deletedAt: null,
      deletedById: null,
      submissions: [],
    });
  });

  it('carries every field it has, its rows included', () => {
    const full = {
      ...bare,
      ownerUserId: 'o1',
      addressVi: '1 Lê Lợi',
      priceBand: 2,
      phone: '+84',
      websiteUrl: 'https://q.vn',
      status: placeStatusProto.toProto(PlaceStatus.INACTIVE),
      inactiveReason: placeInactiveReasonProto.toProto(PlaceInactiveReason.OWNER),
      activationRequestedAt: at('2026-10-04T00:00:00Z'),
      publishedAt: at('2026-10-05T00:00:00Z'),
      deletedAt: at('2026-10-06T00:00:00Z'),
      deletedById: 'u2',
      localizations: [
        {
          lang: 'en',
          textReady: true,
          stale: false,
          audioStatus: audioStatusProto.toProto(AudioStatus.READY),
          audioStale: false,
          translationSource: translationSourceProto.toProto(TranslationSource.MACHINE),
          audioDurationMs: 9000,
          voiceId: 'v1',
        },
        {
          lang: 'ja',
          textReady: false,
          stale: false,
          audioStatus: audioStatusProto.toProto(AudioStatus.PENDING),
          audioStale: false,
          translationSource: translationSourceProto.toProto(TranslationSource.MACHINE),
        },
      ],
      photos: [
        {
          id: 'ph1',
          sortOrder: 0,
          altTextVi: 'Mặt tiền',
          variants: { thumb: photoView('t'), card: photoView('c'), full: photoView('f') },
          originalSha256: 'o',
        },
        {
          id: 'ph2',
          sortOrder: 1,
          variants: { thumb: photoView('t'), card: photoView('c'), full: photoView('f') },
          originalSha256: 'o',
        },
      ],
      menuItems: [
        {
          id: 'm1',
          nameVi: 'Phở',
          descriptionVi: 'Bò',
          priceMinor: 50000,
          isAvailable: true,
          sortOrder: 0,
        },
        { id: 'm2', nameVi: 'Trà', isAvailable: false, sortOrder: 1 },
      ],
      activationMissing: ['en.audio', 'something-new'],
    } as unknown as catalogGrpc.AdminPlace;
    const dto = toAdminPlaceResponseDto(full);
    expect(dto).toMatchObject({
      ownerUserId: 'o1',
      addressVi: '1 Lê Lợi',
      priceBand: 2,
      phone: '+84',
      websiteUrl: 'https://q.vn',
      inactiveReason: PlaceInactiveReason.OWNER,
      activationRequestedAt: '2026-10-04T00:00:00.000Z',
      publishedAt: '2026-10-05T00:00:00.000Z',
      deletedAt: '2026-10-06T00:00:00.000Z',
      deletedById: 'u2',
    });
    expect(dto.localizations.map((row) => [row.audioDurationMs, row.voiceId])).toEqual([
      [9000, 'v1'],
      [null, null],
    ]);
    expect(dto.photos.map((photo) => photo.altTextVi)).toEqual(['Mặt tiền', null]);
    expect(dto.menuItems.map((item) => [item.descriptionVi, item.priceMinor])).toEqual([
      ['Bò', 50000],
      [null, null],
    ]);
    // The gate names only what it knows; anything newer from catalog is left out.
    expect(dto.activationMissing).toEqual(['en.audio']);
  });

  it('fails loudly on a response without its Place, or an enum it doesn’t know', () => {
    expect(() => toAdminPlaceResponseDto(undefined)).toThrow(/without its place/);
    expect(() => toAdminPlaceResponseDto(null)).toThrow(/without its place/);
    expect(() => toAdminPlaceResponseDto({ ...bare, kind: 99 as catalogGrpc.PlaceKind })).toThrow(
      /unknown kind: 99/,
    );
  });
});

const row = {
  id: 'p1',
  kind: placeKindProto.toProto(PlaceKind.EDITORIAL),
  publicCode: 'K7M2Q9XA',
  nameVi: 'Chùa',
  categoryCode: 'TEMPLE',
  areaId: 'a1',
  areaCode: 'd1',
  status: placeStatusProto.toProto(PlaceStatus.PROCESSING),
  syncVersion: 1,
  updatedAt: at('2026-10-02T00:00:00Z'),
  location: { lat: 10.77, lng: 106.7 },
  statusChangedAt: at('2026-10-03T00:00:00Z'),
  boosted: false,
} as unknown as catalogGrpc.AdminPlaceListItem;

describe('a console row', () => {
  it('has no cover, owner or deletion when catalog sends none', () => {
    expect(toAdminPlaceListItemResponseDto(row)).toMatchObject({
      cover: null,
      ownerUserId: null,
      deletedAt: null,
      inactiveReason: null,
    });
  });

  it('carries the cover and owner it has', () => {
    const dto = toAdminPlaceListItemResponseDto({
      ...row,
      cover: photoView('c'),
      ownerUserId: 'o1',
    });
    expect(dto).toMatchObject({ cover: { url: 'c' }, ownerUserId: 'o1' });
  });
});

describe('the activation gate’s answer', () => {
  it('keeps only the missing pieces the console knows how to say', () => {
    expect(
      toActivationResultResponseDto({
        status: placeStatusProto.toProto(PlaceStatus.DRAFT),
        missing: ['en.text', 'activation', 'later'],
      }),
    ).toEqual({ status: PlaceStatus.DRAFT, missing: ['en.text', 'activation'] });
  });
});

describe('the ListPlaces request', () => {
  it('sends only the filters given, deleted rows left out by default', () => {
    const bareQuery = { page: 1, pageSize: 20, sort: '-updatedAt' } as ListPlacesQueryDto;
    expect(toListPlacesRequest(bareQuery)).toEqual({
      page: { page: 1, pageSize: 20, sort: '-updatedAt' },
      includeDeleted: false,
      processingBefore: undefined,
    });
  });

  it('sends every filter given', () => {
    const query = {
      page: 2,
      pageSize: 10,
      sort: 'nameVi',
      q: 'chùa',
      kind: PlaceKind.EDITORIAL,
      status: PlaceStatus.ACTIVE,
      areaId: 'a1',
      categoryCode: 'TEMPLE',
      ownerUserId: 'o1',
      includeDeleted: true,
    } as ListPlacesQueryDto;
    expect(toListPlacesRequest(query)).toMatchObject({
      page: { q: 'chùa' },
      kind: placeKindProto.toProto(PlaceKind.EDITORIAL),
      status: placeStatusProto.toProto(PlaceStatus.ACTIVE),
      areaId: 'a1',
      categoryCode: 'TEMPLE',
      ownerUserId: 'o1',
      includeDeleted: true,
    });
  });
});

describe('creating an Editorial Place', () => {
  const create = (fields: Partial<CreatePlaceDto>) =>
    toCreateEditorialPlaceRequest({
      nameVi: 'Chùa',
      descriptionVi: 'Mô tả',
      categoryCode: 'TEMPLE',
      location: { lat: 10.77, lng: 106.7 },
      triggerRadiusM: 30,
      narrationPriority: 50,
      photos: [],
      openingHours: [],
      requestActivation: false,
      ...fields,
    });

  it('treats null and absent alike: neither sends the field', () => {
    const request = create({ addressVi: null, priceBand: null, phone: null, websiteUrl: null });
    expect(request.content).not.toHaveProperty('addressVi');
    expect(request.content).not.toHaveProperty('priceBand');
    expect(request.content).not.toHaveProperty('phone');
    expect(request.content).not.toHaveProperty('websiteUrl');
  });

  it('sends the content, photos and hours it has', () => {
    const request = create({
      addressVi: '1 Lê Lợi',
      priceBand: 1,
      phone: '+84',
      websiteUrl: 'https://c.vn',
      photos: [{ uploadId: 'up1', altTextVi: 'Cổng' }, { uploadId: 'up2' }],
      openingHours: [
        { weekday: 1, opensAt: '08:00', closesAt: '17:00', isClosed: false },
        { specificDate: '2026-12-25', isClosed: true },
      ],
    });
    expect(request.content).toMatchObject({
      addressVi: '1 Lê Lợi',
      priceBand: 1,
      phone: '+84',
      websiteUrl: 'https://c.vn',
    });
    expect(request.photos).toEqual([{ uploadId: 'up1', altTextVi: 'Cổng' }, { uploadId: 'up2' }]);
    expect(request.openingHours).toEqual([
      { weekday: 1, opensAt: '08:00', closesAt: '17:00', isClosed: false },
      { specificDate: '2026-12-25', isClosed: true },
    ]);
  });
});

describe('updating a Place', () => {
  it('sends only the fields given; null sends the empty value that clears it', () => {
    expect(toUpdatePlaceRequest('p1', {})).toEqual({
      placeId: 'p1',
      location: undefined,
    });
    expect(
      toUpdatePlaceRequest('p1', {
        nameVi: 'Mới',
        descriptionVi: 'Mô tả',
        categoryCode: 'CAFE',
        addressVi: null,
        priceBand: null,
        phone: null,
        websiteUrl: null,
      }),
    ).toMatchObject({
      nameVi: 'Mới',
      descriptionVi: 'Mô tả',
      categoryCode: 'CAFE',
      addressVi: '',
      priceBand: 0,
      phone: '',
      websiteUrl: '',
    });
    expect(
      toUpdatePlaceRequest('p1', {
        addressVi: '2 Lê Lợi',
        priceBand: 3,
        phone: '+85',
        websiteUrl: 'https://n.vn',
      }),
    ).toMatchObject({
      addressVi: '2 Lê Lợi',
      priceBand: 3,
      phone: '+85',
      websiteUrl: 'https://n.vn',
    });
  });
});

describe('replacing photos, menu and hours', () => {
  it('names kept photos by id and new ones by upload, alt text only when given', () => {
    const body = {
      items: [
        { photoId: 'ph1', altTextVi: 'Cũ' },
        { uploadId: 'up1', altTextVi: null },
      ],
    } as ReplacePhotosDto;
    expect(toReplacePhotosRequest('p1', body).items).toEqual([
      { photoId: 'ph1', altTextVi: 'Cũ' },
      { uploadId: 'up1' },
    ]);
  });

  it('sends the menu in its currency, a dish’s description and price only when given', () => {
    const body = {
      menuCurrency: MenuCurrency.USD,
      items: [
        { nameVi: 'Phở', descriptionVi: 'Bò', priceMinor: 300, isAvailable: true },
        { nameVi: 'Trà', descriptionVi: null, priceMinor: null, isAvailable: false },
      ],
    } as ReplaceMenuDto;
    const request = toReplaceMenuRequest('p1', body);
    expect(request.menuCurrency).toBe(menuCurrencyProto.toProto(MenuCurrency.USD));
    expect(request.items).toEqual([
      { nameVi: 'Phở', descriptionVi: 'Bò', priceMinor: 300, isAvailable: true },
      { nameVi: 'Trà', isAvailable: false },
    ]);
  });

  it('sends each hours row with only the parts it has', () => {
    expect(toReplaceOpeningHoursRequest('p1', { items: [{ weekday: 0, isClosed: true }] })).toEqual(
      { placeId: 'p1', rows: [{ weekday: 0, isClosed: true }] },
    );
  });
});

describe('a stuck Place (product §F7)', () => {
  const nameOf = (id: string) => ({ id, name: `Name ${id}` }) as never;

  it('has no last job when narration has none', () => {
    expect(toStuckPlaceResponseDto(row, undefined, nameOf).lastJob).toBeNull();
    expect(toStuckPlaceResponseDto(row, null, nameOf)).toMatchObject({
      processingSince: '2026-10-03T00:00:00.000Z',
      lastJob: null,
    });
  });

  it('says its last job, who cancelled it, and its error', () => {
    const job = {
      id: 'j1',
      status: synthesisJobStatusProto.toProto(SynthesisJobStatus.CANCELLED),
      finishedAt: at('2026-10-04T00:00:00Z'),
      errorSummary: 'every voice failed',
      cancelledById: 'u3',
    } as unknown as narrationGrpc.TargetLastJob;
    expect(toStuckPlaceResponseDto(row, job, nameOf).lastJob).toEqual({
      id: 'j1',
      status: SynthesisJobStatus.CANCELLED,
      finishedAt: '2026-10-04T00:00:00.000Z',
      errorSummary: 'every voice failed',
      cancelledBy: { id: 'u3', name: 'Name u3' },
    });
    const running = {
      id: 'j2',
      status: synthesisJobStatusProto.toProto(SynthesisJobStatus.RUNNING),
    } as unknown as narrationGrpc.TargetLastJob;
    expect(toStuckPlaceResponseDto(row, running, nameOf).lastJob).toMatchObject({
      finishedAt: null,
      errorSummary: null,
      cancelledBy: null,
    });
  });
});
