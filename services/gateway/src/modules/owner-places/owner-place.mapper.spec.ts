import {
  AudioStatus,
  NarrationLanguageScope,
  PlaceInactiveReason,
  PlaceStatus,
  SubmissionKind,
} from '@wayfare/contracts';
import {
  audioStatusProto,
  placeInactiveReasonProto,
  placeStatusProto,
  submissionKindProto,
} from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import { toOwnerLimitsResponseDto, toOwnerPlaceResponseDto } from './owner-place.mapper';

const at = new Date('2026-05-01T00:00:00.000Z');
const ts = toProtoTimestamp(at);
const place = (over: Partial<catalogGrpc.OwnerPlace> = {}) =>
  ({
    id: 'p1',
    publicCode: 'BT1',
    nameVi: 'Phở',
    categoryCode: 'FOOD',
    areaCode: 'd1',
    status: placeStatusProto.toProto(PlaceStatus.ACTIVE),
    autoNarration: true,
    statusChangedAt: ts,
    localizations: [],
    updatedAt: ts,
    ...over,
  }) as catalogGrpc.OwnerPlace;

describe('an owner’s Venue row', () => {
  it('reads absent reason, cover and pending submission as null', () => {
    expect(toOwnerPlaceResponseDto(place())).toMatchObject({
      status: PlaceStatus.ACTIVE,
      inactiveReason: null,
      cover: null,
      pendingSubmission: null,
    });
  });

  it('reads the reason, cover, languages and pending submission when catalog sends them', () => {
    const photo = { url: 'https://media.test/c.jpg', sha256: 'a', bytes: 1, width: 4, height: 3 };
    expect(
      toOwnerPlaceResponseDto(
        place({
          status: placeStatusProto.toProto(PlaceStatus.INACTIVE),
          inactiveReason: placeInactiveReasonProto.toProto(PlaceInactiveReason.OWNER),
          cover: photo,
          localizations: [
            {
              lang: 'en',
              textReady: true,
              stale: false,
              audioStatus: audioStatusProto.toProto(AudioStatus.READY),
              audioStale: false,
            },
          ],
          pendingSubmission: {
            id: 's1',
            kind: submissionKindProto.toProto(SubmissionKind.UPDATE),
            submittedAt: ts,
          },
        } as never),
      ),
    ).toMatchObject({
      inactiveReason: PlaceInactiveReason.OWNER,
      cover: photo,
      localizations: [{ audioStatus: AudioStatus.READY }],
      pendingSubmission: { id: 's1', kind: SubmissionKind.UPDATE, submittedAt: at.toISOString() },
    });
  });

  it('refuses a status this build doesn’t know', () => {
    expect(() => toOwnerPlaceResponseDto(place({ status: 99 as never }))).toThrow(
      'catalog sent an unknown status: 99',
    );
  });
});

describe('the owner’s limits', () => {
  const limits = {
    maxPlaces: 3,
    used: 1,
    reservedByPendingSubmissions: 0,
    maxPhotosPerPlace: 8,
    maxMenuItemsPerPlace: 50,
    narrationLanguageScope: NarrationLanguageScope.LAUNCH,
    autoNarration: true,
  } as catalogGrpc.GetMyLimitsResponse;

  it('reads a scope this build knows, and refuses one it doesn’t', () => {
    expect(toOwnerLimitsResponseDto(limits).narrationLanguageScope).toBe('LAUNCH');
    expect(() => toOwnerLimitsResponseDto({ ...limits, narrationLanguageScope: 'ALL' })).toThrow(
      'catalog sent an unknown scope: ALL',
    );
  });
});
