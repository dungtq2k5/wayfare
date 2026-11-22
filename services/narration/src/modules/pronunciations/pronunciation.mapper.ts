import type { ReplacementType } from '@wayfare/contracts';
import { replacementTypeProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { PronunciationEntry as EntryRow } from '../../../generated/prisma/client';

/** A dictionary entry's row. */
export type PronunciationRow = EntryRow;

/** A dictionary entry as the console lists it. */
export function toPronunciationEntry(row: PronunciationRow): narrationGrpc.PronunciationEntry {
  return {
    id: row.id,
    term: row.term,
    targetLang: row.targetLang ?? undefined,
    replacementType: replacementTypeProto.toProto(row.replacementType as ReplacementType),
    replacement: row.replacement,
    alphabet: row.alphabet ?? undefined,
    note: row.note ?? undefined,
    isActive: row.isActive,
    updatedAt: toProtoTimestamp(row.updatedAt),
    updatedById: row.updatedById,
  };
}
