import { zOfflineManifest, zOfflineManifestDiff } from '@wayfare/contracts';
import type { OfflineManifest, OfflineManifestDiff } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';

/** The manifest catalog computed and cached, as JSON text. */
export function toOfflineManifest(response: catalogGrpc.GetManifestResponse): OfflineManifest {
  return zOfflineManifest.parse(JSON.parse(response.manifestJson));
}

/** The diff catalog computed, as JSON text. */
export function toOfflineManifestDiff(
  response: catalogGrpc.GetManifestDiffResponse,
): OfflineManifestDiff {
  return zOfflineManifestDiff.parse(JSON.parse(response.diffJson));
}
