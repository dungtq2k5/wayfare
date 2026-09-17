import { zDatasetVersion, zPlaceSyncRecord, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** One delta page (api-endpoints-plan §2.1, rdm-spec §1.7). */
export const syncPlacesResponseSchema = z.object({
  places: z.array(zPlaceSyncRecord),
  /** Every changed Place not live in this area; a client ignores ids it does not hold. */
  removedPlaceIds: z.array(zUuidV7),
  /** One number across all areas; never goes backwards. Send it back as `since`. */
  datasetVersion: zDatasetVersion,
});

/** What `GET /sync/places` returns under `data`. */
export class SyncPlacesResponseDto extends createZodDto(syncPlacesResponseSchema) {}

/** `meta` of a sync page: `complete: false` means ask again from `datasetVersion` now. */
export const syncMetaResponseSchema = z.object({ complete: z.boolean() });

/** What `GET /sync/places` returns under `meta`. */
export class SyncMetaResponseDto extends createZodDto(syncMetaResponseSchema) {}
