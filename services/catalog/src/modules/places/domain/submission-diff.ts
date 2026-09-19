import { canonicalJson, SUBMISSION_EDITABLE_FIELDS } from '@wayfare/contracts';
import type {
  MenuCurrency,
  PlaceSubmissionPayload,
  SubmissionDiffEntry,
  SubmissionEditableField,
} from '@wayfare/contracts';
import { menuCurrencyProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';

/** One opening-hours row, every field stated. */
export interface SnapshotHoursRow {
  readonly weekday: number | null;
  readonly specificDate: string | null;
  readonly opensAt: string | null;
  readonly closesAt: string | null;
  readonly isClosed: boolean;
}

/** One photo: kept by id, or — in a payload — added from an upload. */
export interface SnapshotPhoto {
  readonly photoId?: string;
  readonly uploadId?: string;
  readonly altTextVi: string | null;
}

/** One menu line, every field stated. */
export interface SnapshotMenuItem {
  readonly nameVi: string;
  readonly descriptionVi: string | null;
  readonly priceMinor: number | null;
  readonly isAvailable: boolean;
}

/**
 * A Venue's owner-editable fields in one comparable shape (rdm-spec C-11): what `editableHash`
 * hashes, what a submission stores as its base, and what the diffs compare.
 */
export interface EditableSnapshot {
  readonly nameVi: string;
  readonly descriptionVi: string;
  readonly categoryCode: string;
  readonly location: { readonly lat: number; readonly lng: number };
  readonly addressVi: string | null;
  readonly priceBand: number | null;
  readonly phone: string | null;
  readonly websiteUrl: string | null;
  readonly openingHours: readonly SnapshotHoursRow[];
  readonly photos: readonly SnapshotPhoto[];
  readonly menu: {
    readonly menuCurrency: MenuCurrency;
    readonly items: readonly SnapshotMenuItem[];
  };
}

const hoursRow = (row: {
  weekday?: number | null;
  specificDate?: string | null;
  opensAt?: string | null;
  closesAt?: string | null;
  isClosed: boolean;
}): SnapshotHoursRow => ({
  weekday: row.weekday ?? null,
  specificDate: row.specificDate ?? null,
  opensAt: row.isClosed ? null : (row.opensAt ?? null),
  closesAt: row.isClosed ? null : (row.closesAt ?? null),
  isClosed: row.isClosed,
});

/** The live Venue's editable fields, from catalog's own view of it. */
export function snapshotOfPlace(place: catalogGrpc.AdminPlace): EditableSnapshot {
  const menuCurrency = menuCurrencyProto.fromProto(place.menuCurrency);
  if (menuCurrency === null) throw new Error('A Place with no menu currency');
  return {
    nameVi: place.nameVi,
    descriptionVi: place.descriptionVi,
    categoryCode: place.categoryCode,
    location: { lat: place.location?.lat ?? 0, lng: place.location?.lng ?? 0 },
    addressVi: place.addressVi ?? null,
    priceBand: place.priceBand ?? null,
    phone: place.phone ?? null,
    websiteUrl: place.websiteUrl ?? null,
    openingHours: place.openingHours.map(hoursRow),
    photos: place.photos
      .toSorted((a, b) => a.sortOrder - b.sortOrder)
      .map((photo) => ({ photoId: photo.id, altTextVi: photo.altTextVi ?? null })),
    menu: {
      menuCurrency,
      items: place.menuItems
        .toSorted((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({
          nameVi: item.nameVi,
          descriptionVi: item.descriptionVi ?? null,
          priceMinor: item.priceMinor ?? null,
          isAvailable: item.isAvailable,
        })),
    },
  };
}

/** What a submission's payload asks for, in the same shape. */
export function snapshotOfPayload(payload: PlaceSubmissionPayload): EditableSnapshot {
  return {
    nameVi: payload.nameVi,
    descriptionVi: payload.descriptionVi,
    categoryCode: payload.categoryCode,
    location: { lat: payload.location.lat, lng: payload.location.lng },
    addressVi: payload.addressVi,
    priceBand: payload.priceBand,
    phone: payload.phone,
    websiteUrl: payload.websiteUrl,
    openingHours: payload.openingHours.map(hoursRow),
    photos: payload.photos.map((photo) =>
      photo.photoId === undefined
        ? { uploadId: photo.uploadId, altTextVi: photo.altTextVi }
        : { photoId: photo.photoId, altTextVi: photo.altTextVi },
    ),
    menu: {
      menuCurrency: payload.menu.menuCurrency,
      items: payload.menu.items.map((item) => ({
        nameVi: item.nameVi,
        descriptionVi: item.descriptionVi,
        priceMinor: item.priceMinor,
        isAvailable: item.isAvailable,
      })),
    },
  };
}

/** The fields where two snapshots differ, in the fixed field order. */
export function changedFields(
  base: EditableSnapshot,
  next: EditableSnapshot,
): SubmissionEditableField[] {
  return SUBMISSION_EDITABLE_FIELDS.filter(
    (field) => canonicalJson(base[field]) !== canonicalJson(next[field]),
  );
}

/**
 * The reviewer's field-by-field diff (api-endpoints-plan §3.4): each field the submission changes,
 * from its base (nothing, for a creation) to what it asks for.
 */
export function submissionDiff(
  base: EditableSnapshot | null,
  next: EditableSnapshot,
): SubmissionDiffEntry[] {
  if (base === null) {
    return SUBMISSION_EDITABLE_FIELDS.map((field) => ({ field, before: null, after: next[field] }));
  }
  return changedFields(base, next).map((field) => ({
    field,
    before: base[field],
    after: next[field],
  }));
}
