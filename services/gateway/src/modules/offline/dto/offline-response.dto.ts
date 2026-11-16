import { zOfflineManifest, zOfflineManifestDiff } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';

/** An area's offline pack: every asset with its `sha256`, verified before activation. */
export class OfflineManifestResponseDto extends createZodDto(zOfflineManifest) {}

/** What changed since the pack a device holds. */
export class OfflineManifestDiffResponseDto extends createZodDto(zOfflineManifestDiff) {}
