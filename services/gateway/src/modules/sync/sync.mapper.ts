import { datasetVersionFromWire } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { toPlaceSyncRecord } from '../catalog/catalog.mapper';
import type { SyncPlacesResponseDto } from './dto/sync-response.dto';

/** A delta page; the version becomes a JSON number after the safe-integer check. */
export function toSyncPlacesResponseDto(
  response: catalogGrpc.SyncPlacesResponse,
): SyncPlacesResponseDto {
  return {
    places: response.places.map(toPlaceSyncRecord),
    removedPlaceIds: [...response.removedPlaceIds],
    datasetVersion: datasetVersionFromWire(response.datasetVersion),
  };
}
