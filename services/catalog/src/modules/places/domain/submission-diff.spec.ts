import { MenuCurrency } from '@wayfare/contracts';
import type { PlaceSubmissionPayload } from '@wayfare/contracts';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { describe, expect, it } from 'vitest';
import { editableHash } from './editable-hash';
import {
  baseValuesOf,
  changedFields,
  snapshotOfPayload,
  snapshotOfPlace,
  submissionDiff,
} from './submission-diff';
import type { EditableSnapshot } from './submission-diff';

const base: EditableSnapshot = {
  nameVi: 'Quán',
  descriptionVi: 'Mô tả.',
  categoryCode: 'RESTAURANT',
  location: { lat: 10.77, lng: 106.69 },
  addressVi: null,
  priceBand: 2,
  phone: '+84901234567',
  websiteUrl: null,
  openingHours: [
    { weekday: 1, specificDate: null, opensAt: '08:00', closesAt: '21:00', isClosed: false },
  ],
  photos: [{ photoId: '01990000-0000-7000-8000-000000000001', altTextVi: null }],
  menu: { menuCurrency: MenuCurrency.VND, items: [] },
};

describe('submission diff', () => {
  it('names the fields that differ, in the fixed order', () => {
    const next = { ...base, phone: '+84999999999', descriptionVi: 'Mới.' };
    expect(changedFields(base, next)).toEqual(['descriptionVi', 'phone']);
    expect(submissionDiff(base, next)).toEqual([
      { field: 'descriptionVi', before: 'Mô tả.', after: 'Mới.' },
      { field: 'phone', before: '+84901234567', after: '+84999999999' },
    ]);
  });

  it("gives a conflict's values when the submission was sent", () => {
    // An admin edited the address and the hours after the owner sent their change.
    const live = { ...base, addressVi: '12 Lê Lợi', openingHours: [] };
    const conflict = changedFields(base, live);
    expect(baseValuesOf(base, conflict)).toEqual({
      addressVi: null,
      openingHours: base.openingHours,
    });
    expect(baseValuesOf(base, [])).toEqual({});
  });

  it('shows every field of a creation, from nothing', () => {
    expect(submissionDiff(null, base)).toHaveLength(11);
  });

  it('hashes the editable fields only, stable across key order', () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as EditableSnapshot;
    expect(editableHash(reordered)).toBe(editableHash(base));
    expect(editableHash({ ...base, phone: null })).not.toBe(editableHash(base));
  });
});

/** A live Venue as catalog's admin read gives it, its optional fields absent. */
const live = (overrides: Partial<catalogGrpc.AdminPlace> = {}) =>
  ({
    nameVi: 'Quán',
    descriptionVi: 'Mô tả.',
    categoryCode: 'RESTAURANT',
    location: { lat: 10.77, lng: 106.69 },
    menuCurrency: catalogGrpc.MenuCurrency.MENU_CURRENCY_VND,
    openingHours: [],
    photos: [],
    menuItems: [],
    ...overrides,
  }) as unknown as catalogGrpc.AdminPlace;

describe('the live Venue’s editable fields', () => {
  it('reads every absent optional as none, never as a value', () => {
    const snapshot = snapshotOfPlace(
      live({
        menuItems: [{ id: 'm', nameVi: 'Phở', isAvailable: true, sortOrder: 0 }],
        photos: [{ id: 'p', sortOrder: 0 } as catalogGrpc.AdminPhoto],
      }),
    );
    expect(snapshot).toMatchObject({
      addressVi: null,
      priceBand: null,
      phone: null,
      websiteUrl: null,
    });
    expect(snapshot.photos).toEqual([{ photoId: 'p', altTextVi: null }]);
    expect(snapshot.menu.items).toEqual([
      { nameVi: 'Phở', descriptionVi: null, priceMinor: null, isAvailable: true },
    ]);
  });

  it('lists photos and menu items in their own order, whatever order they arrive in', () => {
    const snapshot = snapshotOfPlace(
      live({
        photos: [
          { id: 'second', sortOrder: 1, altTextVi: 'b' },
          { id: 'first', sortOrder: 0, altTextVi: 'a' },
        ] as catalogGrpc.AdminPhoto[],
        menuItems: [
          { id: '2', nameVi: 'Hai', isAvailable: true, sortOrder: 1, priceMinor: 2 },
          { id: '1', nameVi: 'Một', isAvailable: false, sortOrder: 0, descriptionVi: 'x' },
        ] as catalogGrpc.AdminMenuItem[],
      }),
    );
    expect(snapshot.photos.map((photo) => photo.altTextVi)).toEqual(['a', 'b']);
    expect(snapshot.menu.items.map((item) => item.nameVi)).toEqual(['Một', 'Hai']);
  });

  it('gives a closed day no hours, and a day’s missing fields as none', () => {
    const snapshot = snapshotOfPlace(
      live({
        openingHours: [
          { weekday: 1, opensAt: '08:00', closesAt: '21:00', isClosed: true },
          { specificDate: '2026-12-24', isClosed: false },
        ],
      }),
    );
    expect(snapshot.openingHours).toEqual([
      { weekday: 1, specificDate: null, opensAt: null, closesAt: null, isClosed: true },
      { weekday: null, specificDate: '2026-12-24', opensAt: null, closesAt: null, isClosed: false },
    ]);
  });

  it('places a Venue with no location at 0,0 rather than failing the diff', () => {
    expect(snapshotOfPlace(live({ location: undefined })).location).toEqual({ lat: 0, lng: 0 });
  });

  it('refuses a Venue whose menu currency this build can’t read', () => {
    expect(() =>
      snapshotOfPlace(live({ menuCurrency: catalogGrpc.MenuCurrency.MENU_CURRENCY_UNSPECIFIED })),
    ).toThrow('A Place with no menu currency');
  });
});

describe('what a submission asks for', () => {
  it('keeps a live photo by its id and a new one by its upload', () => {
    const payload = {
      ...base,
      openingHours: [],
      photos: [
        { photoId: 'kept', altTextVi: null },
        { uploadId: 'new', altTextVi: 'Mặt tiền' },
      ],
      menu: { menuCurrency: MenuCurrency.VND, items: [] },
    } as unknown as PlaceSubmissionPayload;
    expect(snapshotOfPayload(payload).photos).toEqual([
      { photoId: 'kept', altTextVi: null },
      { uploadId: 'new', altTextVi: 'Mặt tiền' },
    ]);
  });
});
