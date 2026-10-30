import { servedLanguage } from '@wayfare/contracts';
import type { LocalizationTargetType, OverrideStatus, Correction } from '@wayfare/contracts';
import { localizationTargetTypeProto, overrideStatusProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { LocalizationOverride } from '../../../generated/prisma/client';

/**
 * A correction on the wire. Both sides are called `Correction`, so the proto side takes the name
 * the mapper convention gives a gRPC type (conventions §15, as `fromProto…` spells it).
 */
type ProtoCorrection = narrationGrpc.Correction;

/** A correction's row. */
export type OverrideRow = LocalizationOverride;

/** A correction's row as raw SQL returns it: the columns' own names. */
export interface OverrideColumnsRow {
  readonly id: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly lang: string;
  readonly source_content_hash: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly edited_by_id: string;
  readonly reverted_by_id: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** A raw row as Prisma's own type. */
export function fromOverrideColumnsRow(row: OverrideColumnsRow): OverrideRow {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    lang: row.lang,
    sourceContentHash: row.source_content_hash,
    name: row.name,
    description: row.description,
    status: row.status,
    editedById: row.edited_by_id,
    revertedById: row.reverted_by_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A correction as the console shows it; `supersededByHash` is the target's current hash away. */
export function toCorrection(row: OverrideRow, currentHash: string): Correction {
  return {
    id: row.id,
    targetType: row.targetType as LocalizationTargetType,
    targetId: row.targetId,
    lang: servedLanguage(row.lang, `correction ${row.id}`),
    sourceContentHash: row.sourceContentHash,
    name: row.name,
    description: row.description,
    status: row.status as OverrideStatus,
    supersededByHash: row.sourceContentHash !== currentHash,
    editedById: row.editedById,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The same correction, for a gRPC response. */
export function toProtoCorrection(correction: Correction): ProtoCorrection {
  return {
    id: correction.id,
    targetType: localizationTargetTypeProto.toProto(correction.targetType),
    targetId: correction.targetId,
    lang: correction.lang,
    sourceContentHash: correction.sourceContentHash,
    name: correction.name,
    description: correction.description ?? undefined,
    status: overrideStatusProto.toProto(correction.status),
    supersededByHash: correction.supersededByHash,
    editedById: correction.editedById,
    updatedAt: toProtoTimestamp(new Date(correction.updatedAt)),
  };
}
