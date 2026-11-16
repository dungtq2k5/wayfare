import { servedLanguage, zLocalizationOverview } from '@wayfare/contracts';
import type { Correction, LocalizationOverview, OverrideStatus } from '@wayfare/contracts';
import { localizationTargetTypeProto, overrideStatusProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { fromProtoTimestamp } from '@wayfare/nest-common';

/** A correction's status; an unknown value is a narration newer than this gateway. */
function statusOf(value: number): OverrideStatus {
  const status = overrideStatusProto.fromProto(value);
  if (status === null) throw new Error(`narration sent an unknown override status: ${value}`);
  return status;
}

/** A correction as the console shows it. */
export function toCorrection(correction: narrationGrpc.Correction | undefined): Correction {
  if (correction === undefined) throw new Error('narration sent no correction');
  const targetType = localizationTargetTypeProto.fromProto(correction.targetType);
  if (targetType === null) throw new Error('narration sent an unknown target type');
  return {
    id: correction.id,
    targetType,
    targetId: correction.targetId,
    lang: servedLanguage(correction.lang, `correction ${correction.id}`),
    sourceContentHash: correction.sourceContentHash,
    name: correction.name,
    description: correction.description ?? null,
    status: statusOf(correction.status),
    supersededByHash: correction.supersededByHash,
    editedById: correction.editedById,
    updatedAt: fromProtoTimestamp(correction.updatedAt, 'updatedAt').toISOString(),
  };
}

/** The correction screen narration computed, as JSON text. */
export function toLocalizationOverview(
  response: narrationGrpc.GetLocalizationOverviewResponse,
): LocalizationOverview {
  return zLocalizationOverview.parse(JSON.parse(response.overviewJson));
}
