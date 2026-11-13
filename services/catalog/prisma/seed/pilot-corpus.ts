// The pilot corpus as committed JSON (ADR 0002): an area and its Editorial Places, validated with
// the same contracts the admin routes use. JSON, so a reviewer can correct a text in a pull request.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  MAX_ALT_TEXT_LENGTH,
  MAX_PHOTOS_PER_PLACE,
  MAX_TRIGGER_RADIUS_M,
  MIN_TRIGGER_RADIUS_M,
  NARRATION_PRIORITY_MAX,
  NARRATION_PRIORITY_MIN,
  zOpeningHours,
  zPlaceContentInput,
  zPublicCode,
  zAreaCreateInput,
  zUuidV7,
} from '@wayfare/contracts';
import { packageRoot } from '@wayfare/nest-common';
import { z } from 'zod';

/** The committed pilot area (rdm-spec C-3). */
export const zPilotArea = zAreaCreateInput
  .omit({ isActive: true })
  .extend({ id: zUuidV7 })
  .strict();
/** The committed pilot area. */
export type PilotArea = z.output<typeof zPilotArea>;

/** One committed Place: its content, its committed identity, and its review state (ADR 0002). */
export const zPilotPlace = zPlaceContentInput
  .extend({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    id: zUuidV7,
    publicCode: zPublicCode,
    /** `DRAFT` until a reviewer has read the text and checked the facts. */
    review: z.enum(['DRAFT', 'REVIEWED']),
    /** `OSM` when checked on OpenStreetMap, else `APPROXIMATE`. */
    locationSource: z.enum(['OSM', 'APPROXIMATE']),
    triggerRadiusM: z.number().int().min(MIN_TRIGGER_RADIUS_M).max(MAX_TRIGGER_RADIUS_M),
    narrationPriority: z.number().int().min(NARRATION_PRIORITY_MIN).max(NARRATION_PRIORITY_MAX),
    openingHours: zOpeningHours,
    photos: z
      .array(
        z
          .object({
            file: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+\.(?:jpe?g|webp)$/),
            altTextVi: z.string().min(1).max(MAX_ALT_TEXT_LENGTH).optional(),
          })
          .strict(),
      )
      .max(MAX_PHOTOS_PER_PLACE),
  })
  .strict();
/** One committed Place. */
export type PilotPlace = z.output<typeof zPilotPlace>;

/** A loaded corpus and the folder its photos are read from. */
export interface PilotCorpus {
  readonly area: PilotArea;
  readonly places: readonly PilotPlace[];
  readonly photosDir: string;
}

/** The committed District 1 corpus folder, found from the package root in both layouts. */
export const PILOT_D1_DIR = resolve(packageRoot(__dirname), 'prisma/seed/pilot-d1');

/** Reads and validates a corpus folder; throws naming the first bad entry. */
export function loadPilotCorpus(dir: string = PILOT_D1_DIR): PilotCorpus {
  const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));
  return {
    area: zPilotArea.parse(read('area.json')),
    places: z.array(zPilotPlace).parse(read('places.json')),
    photosDir: join(dir, 'photos'),
  };
}
