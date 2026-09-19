import { NarrationLanguageScope } from '@wayfare/contracts';
import type { ProtoEnumBridge, SubmissionKind } from '@wayfare/contracts';
import {
  audioStatusProto,
  placeInactiveReasonProto,
  placeStatusProto,
  submissionKindProto,
} from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { fromProtoTimestamp } from '@wayfare/nest-common';
import { toPhotoView } from '../catalog/catalog.mapper';
import type { OwnerLimitsResponseDto, OwnerPlaceResponseDto } from './dto/owner-place-response.dto';

function known<D extends string>(
  bridge: ProtoEnumBridge<D, number>,
  value: number | undefined,
  field: string,
): D {
  const member = bridge.fromProto(value);
  if (member === null) throw new Error(`catalog sent an unknown ${field}: ${String(value)}`);
  return member;
}

/** One owner Venue row; `boosted` is `null` until discovery boosts exist. */
export function toOwnerPlaceResponseDto(place: catalogGrpc.OwnerPlace): OwnerPlaceResponseDto {
  const pending = place.pendingSubmission;
  return {
    id: place.id,
    publicCode: place.publicCode,
    nameVi: place.nameVi,
    categoryCode: place.categoryCode,
    status: known(placeStatusProto, place.status, 'status'),
    inactiveReason:
      place.inactiveReason == null
        ? null
        : known(placeInactiveReasonProto, place.inactiveReason, 'inactiveReason'),
    autoNarration: place.autoNarration,
    boosted: null,
    cover: place.cover == null ? null : toPhotoView(place.cover),
    localizations: place.localizations.map((localization) => ({
      lang: localization.lang,
      textReady: localization.textReady,
      stale: localization.stale,
      audioStatus: known(audioStatusProto, localization.audioStatus, 'audioStatus'),
      audioStale: localization.audioStale,
    })),
    pendingSubmission:
      pending == null
        ? null
        : {
            id: pending.id,
            kind: known<SubmissionKind>(submissionKindProto, pending.kind, 'kind'),
            submittedAt: fromProtoTimestamp(pending.submittedAt, 'submittedAt').toISOString(),
          },
    updatedAt: fromProtoTimestamp(place.updatedAt, 'updatedAt').toISOString(),
  };
}

/** The effective limits; the scope is one this build knows. */
export function toOwnerLimitsResponseDto(
  limits: catalogGrpc.GetMyLimitsResponse,
): OwnerLimitsResponseDto {
  const scope = limits.narrationLanguageScope as NarrationLanguageScope;
  if (!Object.values(NarrationLanguageScope).includes(scope)) {
    throw new Error(`catalog sent an unknown scope: ${limits.narrationLanguageScope}`);
  }
  return {
    maxPlaces: limits.maxPlaces,
    used: limits.used,
    reservedByPendingSubmissions: limits.reservedByPendingSubmissions,
    maxPhotosPerPlace: limits.maxPhotosPerPlace,
    maxMenuItemsPerPlace: limits.maxMenuItemsPerPlace,
    narrationLanguageScope: scope,
    autoNarration: limits.autoNarration,
  };
}
