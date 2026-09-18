// Small builders shared by the catalog integration suites.
import { createHash } from 'node:crypto';
import {
  AudioStatus,
  newId,
  PlaceKind,
  PlaceStatus,
  TranslationSource,
  UploadPurpose,
} from '@wayfare/contracts';
import type { GeoPoint, PhotoVariants } from '@wayfare/contracts';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { FIXTURE_INSIDE } from '@wayfare/contracts/testing';
import type { AccountContext } from '@wayfare/nest-common';
import { buildAccountContext, buildDeviceContext } from '@wayfare/nest-common/testing';
import type { PrismaService } from '../../src/modules/prisma/prisma.service';
import { placeContentHash } from '../../src/modules/places/places.service';
import { bumpSyncVersion } from '../../src/modules/sync/sync.service';
import { insertArea, seededCategory } from './database';

/** A staff account allowed every place route. */
export function staff(overrides: Partial<Omit<AccountContext, 'kind'>> = {}): AccountContext {
  return buildAccountContext({
    permissions: ['place.read', 'place.create', 'place.update', 'place.publish', 'place.delete'],
    ...overrides,
  });
}

/** A tourist device. */
export const device = () => buildDeviceContext();

/** A failed call's code and details. */
export async function errorOf(
  promise: Promise<unknown>,
): Promise<{ code: string; details: unknown }> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (e: unknown) => e,
  );
  const rpc = error as { getError?: () => { metadata: { get(key: string): unknown[] } } };
  if (typeof rpc.getError !== 'function') throw error;
  const metadata = rpc.getError().metadata;
  const details = metadata.get('wf-error-details')[0];
  return {
    code: String(metadata.get('wf-error-code')[0]),
    details: typeof details === 'string' ? (JSON.parse(details) as unknown) : undefined,
  };
}

/**
 * A fixture area and the seeded categories the suites use: `MARKET` and `LANDMARK` (any Place),
 * `RESTAURANT` (Venues only). The area is the test's own, never the pilot geometry.
 */
export async function taxonomy(prisma: PrismaService) {
  const area = await insertArea(prisma);
  const any = await seededCategory(prisma, 'MARKET');
  const landmark = await seededCategory(prisma, 'LANDMARK');
  const venueOnly = await seededCategory(prisma, 'RESTAURANT');
  return { area, any, landmark, venueOnly };
}

/** A proto `PlaceContent`. */
export function contentInput(
  overrides: Partial<catalogGrpc.PlaceContent> = {},
): catalogGrpc.PlaceContent {
  return {
    nameVi: 'Chợ Bến Thành',
    descriptionVi: 'Chợ có từ năm 1914.',
    categoryCode: 'MARKET',
    location: FIXTURE_INSIDE,
    ...overrides,
  };
}

/** A proto `CreateEditorialPlaceRequest`. */
export function createRequest(
  overrides: Partial<catalogGrpc.CreateEditorialPlaceRequest> = {},
): catalogGrpc.CreateEditorialPlaceRequest {
  return {
    content: contentInput(),
    triggerRadiusM: 30,
    narrationPriority: 50,
    photos: [],
    openingHours: [],
    requestActivation: false,
    ...overrides,
  };
}

/** A proto `UpdatePlaceRequest` changing only `fields`. */
export function updateRequest(
  placeId: string,
  fields: Partial<Omit<catalogGrpc.UpdatePlaceRequest, 'placeId'>>,
): catalogGrpc.UpdatePlaceRequest {
  return { placeId, location: undefined, ...fields };
}

const hex = (value: string) => createHash('sha256').update(value).digest('hex');

/** A confirmed upload row, as confirm leaves it — no objects behind it. */
export async function confirmedUpload(
  prisma: PrismaService,
  uploaderUserId: string,
  options: { purpose?: UploadPurpose; confirmedAt?: Date; consumedAt?: Date | null } = {},
): Promise<{ id: string; sha256: string; variants: PhotoVariants }> {
  const id = newId();
  const variant = (name: string, width: number) => ({
    objectPath: `photos/${id}/${name}.webp`,
    sha256: hex(`${id}-${name}`),
    bytes: 1000,
    width,
    height: Math.round(width * 0.75),
  });
  const variants = {
    thumb: variant('thumb', 320),
    card: variant('card', 800),
    full: variant('full', 1600),
  };
  const sha256 = hex(id);
  const confirmedAt = options.confirmedAt ?? new Date();
  await prisma.pendingUpload.create({
    data: {
      id,
      purpose: options.purpose ?? UploadPurpose.PLACE_PHOTO,
      uploaderUserId,
      objectPath: `uploads/${id}/original`,
      declaredContentType: 'image/jpeg',
      maxBytes: 5 * 1024 * 1024,
      expiresAt: new Date(confirmedAt.getTime() + 15 * 60 * 1000),
      confirmedAt,
      sniffedContentType: 'image/jpeg',
      bytes: 2000,
      sha256,
      variants,
      consumedAt: options.consumedAt ?? null,
    },
  });
  return { id, sha256, variants };
}

/** Inserts a Place directly — a Venue included, which no route here creates. */
export async function insertPlace(
  prisma: PrismaService,
  input: {
    areaId: string;
    categoryId: string;
    kind?: PlaceKind;
    status?: PlaceStatus;
    location?: GeoPoint;
    name?: string;
    description?: string;
    discoveryBoost?: number;
    deleted?: boolean;
    publicCode?: string;
  },
): Promise<{ id: string; contentHash: string; publicCode: string }> {
  const id = newId();
  const kind = input.kind ?? PlaceKind.EDITORIAL;
  const name = input.name ?? `Place ${id.slice(-6)}`;
  const description = input.description ?? 'Mô tả.';
  const hash = placeContentHash(name, description);
  const status = input.status ?? PlaceStatus.ACTIVE;
  const location = input.location ?? FIXTURE_INSIDE;
  const publicCode = input.publicCode ?? randomCode();
  await prisma.$transaction(async (tx) => {
    // longitude first
    await tx.$executeRaw`
      INSERT INTO places (
        id, kind, owner_user_id, public_code, category_id, area_id, name_vi, description_vi,
        content_hash, location, auto_narration_enabled, discovery_boost, status, inactive_reason,
        activation_requested_at, published_at, sync_version, created_by_id, deleted_at
      ) VALUES (
        ${id}::uuid, ${kind}, ${kind === PlaceKind.VENUE ? newId() : null}::uuid, ${publicCode},
        ${input.categoryId}::uuid, ${input.areaId}::uuid, ${name}, ${description}, ${hash},
        ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography,
        true, ${input.discoveryBoost ?? 0}, ${status},
        ${status === PlaceStatus.INACTIVE ? 'ADMIN' : null},
        ${status === PlaceStatus.DRAFT ? null : new Date()},
        ${status === PlaceStatus.ACTIVE ? new Date() : null},
        nextval('catalog_sync_version_seq'), ${newId()}::uuid,
        ${input.deleted === true ? new Date() : null}
      )`;
    await bumpSyncVersion(tx, id);
  });
  return { id, contentHash: hash, publicCode };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let codeCounter = 0;

/** A unique public code for fixtures. */
export function randomCode(): string {
  codeCounter += 1;
  let value = Date.now() * 1000 + codeCounter;
  let code = '';
  for (let index = 0; index < 8; index++) {
    code = CROCKFORD[value % 32]! + code;
    value = Math.floor(value / 32);
  }
  return code;
}

/** A ready localization row written directly (the consumer's job, bypassed). */
export async function insertLocalization(
  prisma: PrismaService,
  placeId: string,
  lang: string,
  hash: string,
  options: { audioHash?: string | null; name?: string } = {},
): Promise<void> {
  const audioHash = options.audioHash === undefined ? hash : options.audioHash;
  await prisma.placeLocalization.create({
    data: {
      placeId,
      lang,
      name: options.name ?? `name-${lang}`,
      description: `description-${lang}`,
      sourceContentHash: hash,
      translationSource: lang === 'vi' ? TranslationSource.SOURCE : TranslationSource.MACHINE,
      audioStatus: audioHash === null ? AudioStatus.PENDING : AudioStatus.READY,
      ...(audioHash === null
        ? {}
        : {
            audioSourceContentHash: audioHash,
            audioObjectPath: `audio/${audioHash.slice(0, 8)}-${lang}.mp3`,
            audioSha256: 'e'.repeat(64),
            audioBytes: 1000,
            audioDurationMs: 2000,
          }),
    },
  });
}

/** The outbox rows for a subject, oldest first. */
export async function outboxPayloads(prisma: PrismaService, subject: string) {
  const rows = await prisma.outboxEvent.findMany({
    where: { subject },
    orderBy: { id: 'asc' },
    select: { payload: true },
  });
  return rows.map((row) => row.payload as Record<string, unknown>);
}

export const PLACE_STATUS = catalogGrpc.PlaceStatus;
