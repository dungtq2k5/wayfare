// The pilot corpus reconciled against the database (ADR 0002, conventions §8.1): additive, never
// deleting, and writing only through catalog's own services, so hashes, `sync_version`, events and
// audit rows are the real ones. Reads compare with plain queries; nothing is written that is equal.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareStrings } from '@wayfare/contracts';
import type { OpeningHoursRow } from '@wayfare/contracts';
import { isGrpcServiceError, readGrpcErrorInfo } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { RpcException } from '@nestjs/microservices';
import type { AreasService } from '../../src/modules/areas/areas.service';
import type { PlacesService } from '../../src/modules/places/places.service';
import type { PrismaService } from '../../src/modules/prisma/prisma.service';
import type { UploadsService } from '../../src/modules/uploads/uploads.service';
import type { PilotCorpus, PilotPlace } from './pilot-corpus';

/** The services the seeder writes through. */
export interface PilotSeederDeps {
  readonly places: Pick<
    PlacesService,
    | 'createEditorialPlace'
    | 'updatePlace'
    | 'updateEditorial'
    | 'replacePhotos'
    | 'replaceOpeningHours'
  >;
  readonly uploads: Pick<UploadsService, 'importOriginal'>;
  readonly areas: Pick<AreasService, 'upsertArea'>;
  readonly prisma: PrismaService;
}

/** One reported row. */
export interface SeedRow {
  readonly slug: string;
  readonly outcome: 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed';
  readonly detail?: string;
}

/** What a run did. */
export interface SeedReport {
  readonly area: string;
  /** Set when the area could not be written: the Places were not attempted. */
  readonly stopped: string | null;
  readonly rows: readonly SeedRow[];
  readonly withoutPhotos: number;
  readonly drafts: number;
  readonly approximate: number;
}

/** A Place as stored, in the corpus's terms. */
interface StoredPlace {
  id: string;
  public_code: string;
  name_vi: string;
  description_vi: string;
  address_vi: string | null;
  price_band: number | null;
  phone: string | null;
  website_url: string | null;
  trigger_radius_m: number;
  narration_priority: number;
  status: string;
  deleted_at: Date | null;
  category_code: string;
  lat: number;
  lng: number;
}

/** Coordinates equal to within about a centimetre. */
const SAME_DEGREES = 1e-7;

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const contentTypeOf = (file: string) => (file.endsWith('.webp') ? 'image/webp' : 'image/jpeg');

/** An hours row in one canonical spelling, for comparing sets. */
const hoursKey = (row: OpeningHoursRow) =>
  JSON.stringify([
    row.weekday ?? null,
    row.specificDate ?? null,
    row.opensAt ?? null,
    row.closesAt ?? null,
    row.isClosed,
  ]);

const sameHours = (a: readonly OpeningHoursRow[], b: readonly OpeningHoursRow[]) =>
  JSON.stringify(a.map(hoursKey).toSorted(compareStrings)) ===
  JSON.stringify(b.map(hoursKey).toSorted(compareStrings));

/** A refusal's error code, or the message. */
function reasonOf(error: unknown): string {
  if (error instanceof RpcException) {
    const failure = error.getError() as { metadata?: { get(key: string): unknown[] } };
    const code = failure.metadata?.get('wf-error-code')[0];
    if (typeof code === 'string') return code;
  }
  if (isGrpcServiceError(error)) return readGrpcErrorInfo(error)?.code ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reconciles each corpus Place, in file order, as the seed editor:
 *
 * - absent → created with its committed id and code, `requestActivation`, photos and hours;
 * - deleted by an admin → left deleted, reported;
 * - present → only what differs is written: content, editorial fields, the ordered photos, hours;
 * - equal → nothing is written at all.
 */
export class PilotSeeder {
  constructor(
    private readonly deps: PilotSeederDeps,
    private readonly context: AccountContext,
  ) {}

  async run(corpus: PilotCorpus): Promise<SeedReport> {
    const counts = {
      withoutPhotos: corpus.places.filter((place) => place.photos.length === 0).length,
      drafts: corpus.places.filter((place) => place.review === 'DRAFT').length,
      approximate: corpus.places.filter((place) => place.locationSource === 'APPROXIMATE').length,
    };
    const area = await this.deps.areas.upsertArea(this.context, { ...corpus.area, isActive: true });
    if (area.outcome === 'overlaps') {
      return {
        area: corpus.area.code,
        stopped:
          `the active area(s) ${area.codes.join(', ')} overlap ${corpus.area.code} — deactivate ` +
          'them, or reset the database with `docker compose down -v`',
        rows: [],
        ...counts,
      };
    }
    if (area.outcome === 'uncovers') {
      return {
        area: corpus.area.code,
        stopped: `the new boundary of ${corpus.area.code} would leave Places ${area.placeIds.join(', ')} outside it`,
        rows: [],
        ...counts,
      };
    }
    const rows: SeedRow[] = [];
    for (const place of corpus.places) {
      try {
        rows.push(await this.reconcile(place, corpus.photosDir));
      } catch (error) {
        rows.push({ slug: place.slug, outcome: 'failed', detail: reasonOf(error) });
      }
    }
    return {
      area: `${corpus.area.code}: ${area.outcome === 'updated' ? `updated (${area.fields.join(', ')})` : area.outcome}`,
      stopped: null,
      rows,
      ...counts,
    };
  }

  private async reconcile(place: PilotPlace, photosDir: string): Promise<SeedRow> {
    const photos = place.photos.map((photo) => {
      const bytes = readFileSync(join(photosDir, photo.file));
      return { ...photo, bytes, sha256: sha256(bytes) };
    });
    const stored = await this.stored(place.id);

    if (stored === null) {
      const taken = await this.deps.prisma.place.findUnique({
        where: { publicCode: place.publicCode },
        select: { id: true },
      });
      if (taken !== null) {
        return { slug: place.slug, outcome: 'skipped', detail: `code taken by ${taken.id}` };
      }
      const uploads = [];
      for (const photo of photos) {
        const { uploadId } = await this.deps.uploads.importOriginal(this.context, {
          bytes: photo.bytes,
          contentType: contentTypeOf(photo.file),
        });
        uploads.push({
          uploadId,
          ...(photo.altTextVi === undefined ? {} : { altTextVi: photo.altTextVi }),
        });
      }
      await this.deps.places.createEditorialPlace(
        {
          content: {
            nameVi: place.nameVi,
            descriptionVi: place.descriptionVi,
            categoryCode: place.categoryCode,
            location: place.location,
            ...(place.addressVi == null ? {} : { addressVi: place.addressVi }),
            ...(place.priceBand == null ? {} : { priceBand: place.priceBand }),
            ...(place.phone == null ? {} : { phone: place.phone }),
            ...(place.websiteUrl == null ? {} : { websiteUrl: place.websiteUrl }),
          },
          triggerRadiusM: place.triggerRadiusM,
          narrationPriority: place.narrationPriority,
          photos: uploads,
          openingHours: place.openingHours,
          requestActivation: true,
        },
        this.context,
        { id: place.id, publicCode: place.publicCode },
      );
      return { slug: place.slug, outcome: 'created' };
    }

    if (stored.deleted_at !== null) {
      return { slug: place.slug, outcome: 'skipped', detail: 'deleted by an admin' };
    }

    const changed: string[] = [];
    const content = this.contentChanges(place, stored);
    if (Object.keys(content).length > 0) {
      await this.deps.places.updatePlace(
        { placeId: place.id, location: undefined, ...content },
        this.context,
      );
      changed.push(...Object.keys(content));
    }
    if (
      stored.trigger_radius_m !== place.triggerRadiusM ||
      stored.narration_priority !== place.narrationPriority
    ) {
      await this.deps.places.updateEditorial(
        {
          placeId: place.id,
          triggerRadiusM: place.triggerRadiusM,
          narrationPriority: place.narrationPriority,
        },
        this.context,
      );
      changed.push('editorial');
    }
    if (await this.photosDiffer(place.id, photos)) {
      const current = await this.deps.prisma.placePhoto.findMany({
        where: { placeId: place.id },
        select: { id: true, originalSha256: true },
      });
      const items = [];
      for (const photo of photos) {
        const kept = current.find((row) => row.originalSha256 === photo.sha256);
        const alt = photo.altTextVi === undefined ? {} : { altTextVi: photo.altTextVi };
        if (kept !== undefined) {
          items.push({ photoId: kept.id, ...alt });
          continue;
        }
        const { uploadId } = await this.deps.uploads.importOriginal(this.context, {
          bytes: photo.bytes,
          contentType: contentTypeOf(photo.file),
        });
        items.push({ uploadId, ...alt });
      }
      await this.deps.places.replacePhotos({ placeId: place.id, items }, this.context);
      changed.push('photos');
    }
    if (!sameHours(await this.storedHours(place.id), place.openingHours)) {
      await this.deps.places.replaceOpeningHours(
        { placeId: place.id, rows: place.openingHours },
        this.context,
      );
      changed.push('openingHours');
    }
    const draft =
      stored.status === 'DRAFT' ? ' — left in DRAFT: an admin withdrew its activation' : '';
    if (changed.length === 0) {
      return {
        slug: place.slug,
        outcome: 'unchanged',
        ...(draft === '' ? {} : { detail: draft.slice(3) }),
      };
    }
    return { slug: place.slug, outcome: 'updated', detail: `${changed.join(', ')}${draft}` };
  }

  /** The `UpdatePlace` fields that differ; an emptied optional field is sent as its clearing value. */
  private contentChanges(place: PilotPlace, stored: StoredPlace) {
    const text = (value: string | null | undefined) => value ?? null;
    return {
      ...(stored.name_vi === place.nameVi ? {} : { nameVi: place.nameVi }),
      ...(stored.description_vi === place.descriptionVi
        ? {}
        : { descriptionVi: place.descriptionVi }),
      ...(stored.category_code === place.categoryCode ? {} : { categoryCode: place.categoryCode }),
      ...(Math.abs(stored.lat - place.location.lat) < SAME_DEGREES &&
      Math.abs(stored.lng - place.location.lng) < SAME_DEGREES
        ? {}
        : { location: place.location }),
      ...(stored.address_vi === text(place.addressVi) ? {} : { addressVi: place.addressVi ?? '' }),
      ...(stored.price_band === (place.priceBand ?? null)
        ? {}
        : { priceBand: place.priceBand ?? 0 }),
      ...(stored.phone === text(place.phone) ? {} : { phone: place.phone ?? '' }),
      ...(stored.website_url === text(place.websiteUrl)
        ? {}
        : { websiteUrl: place.websiteUrl ?? '' }),
    };
  }

  private async stored(placeId: string): Promise<StoredPlace | null> {
    // longitude first
    const [row] = await this.deps.prisma.$queryRaw<StoredPlace[]>`
      SELECT p.id, p.public_code, p.name_vi, p.description_vi, p.address_vi, p.price_band, p.phone,
             p.website_url, p.trigger_radius_m, p.narration_priority, p.status, p.deleted_at,
             c.code AS category_code,
             ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng
      FROM places p JOIN categories c ON c.id = p.category_id
      WHERE p.id = ${placeId}::uuid`;
    return row ?? null;
  }

  /** Whether the ordered photos (by original hash) or their alt texts differ. */
  private async photosDiffer(
    placeId: string,
    photos: readonly { sha256: string; altTextVi?: string }[],
  ): Promise<boolean> {
    const current = await this.deps.prisma.placePhoto.findMany({
      where: { placeId },
      orderBy: { sortOrder: 'asc' },
      select: { originalSha256: true, altTextVi: true },
    });
    return (
      JSON.stringify(current.map((row) => [row.originalSha256, row.altTextVi ?? null])) !==
      JSON.stringify(photos.map((photo) => [photo.sha256, photo.altTextVi ?? null]))
    );
  }

  private async storedHours(placeId: string): Promise<OpeningHoursRow[]> {
    const rows = await this.deps.prisma.placeOpeningHours.findMany({ where: { placeId } });
    const time = (value: Date | null) =>
      value === null ? undefined : value.toISOString().slice(11, 16);
    return rows.map((row) => ({
      ...(row.weekday === null ? {} : { weekday: row.weekday }),
      ...(row.specificDate === null
        ? {}
        : { specificDate: row.specificDate.toISOString().slice(0, 10) }),
      ...(row.opensAt === null ? {} : { opensAt: time(row.opensAt)! }),
      ...(row.closesAt === null ? {} : { closesAt: time(row.closesAt)! }),
      isClosed: row.isClosed,
    }));
  }
}

/** The report as printed lines, totals last. */
export function describeReport(report: SeedReport): string[] {
  if (report.stopped !== null) return [`✗ stopped: ${report.stopped}`];
  const count = (outcome: SeedRow['outcome']) =>
    report.rows.filter((row) => row.outcome === outcome).length;
  return [
    `✓ area ${report.area}`,
    ...report.rows.map(
      (row) =>
        `${row.outcome === 'failed' ? '✗' : '✓'} ${row.slug}: ${row.outcome}${row.detail === undefined ? '' : ` (${row.detail})`}`,
    ),
    `${report.rows.length} Places — ${count('created')} created, ${count('updated')} updated, ` +
      `${count('unchanged')} unchanged, ${count('skipped')} skipped, ${count('failed')} failed`,
    `${report.withoutPhotos} without photos, ${report.drafts} still DRAFT, ${report.approximate} with an APPROXIMATE location`,
  ];
}
