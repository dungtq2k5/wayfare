import { LocalizationTargetType, OverrideStatus } from '@wayfare/contracts';
import { localizationTargetTypeProto, overrideStatusProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import { toCorrection } from './admin-localization.mapper';

const correction = (over: Partial<narrationGrpc.Correction> = {}) =>
  ({
    id: 'k1',
    targetType: localizationTargetTypeProto.toProto(LocalizationTargetType.PLACE),
    targetId: 'p1',
    lang: 'en',
    sourceContentHash: 'h',
    name: 'Ben Thanh',
    status: overrideStatusProto.toProto(OverrideStatus.ACTIVE),
    supersededByHash: '',
    editedById: 'u1',
    updatedAt: toProtoTimestamp(new Date('2026-05-01T00:00:00.000Z')),
    ...over,
  }) as narrationGrpc.Correction;

describe('a correction', () => {
  it('reads an absent description as null, a present one as itself', () => {
    expect(toCorrection(correction())).toMatchObject({
      targetType: LocalizationTargetType.PLACE,
      status: OverrideStatus.ACTIVE,
      description: null,
    });
    expect(toCorrection(correction({ description: 'd' })).description).toBe('d');
  });

  it('refuses no correction, and a target type or status this build doesn’t know', () => {
    expect(() => toCorrection(undefined)).toThrow('narration sent no correction');
    expect(() => toCorrection(correction({ targetType: 99 as never }))).toThrow(
      'unknown target type',
    );
    expect(() => toCorrection(correction({ status: 99 as never }))).toThrow(
      'unknown override status: 99',
    );
  });
});
