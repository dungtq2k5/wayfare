import { ReplacementType } from '@wayfare/contracts';
import type { PronunciationEntry as Entry } from '@wayfare/contracts';
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
  };
}

/** An entry as the domain reads it: what a write states, whatever wire shape it arrived in. */
export function fromProtoPronunciationDraft(draft: narrationGrpc.PronunciationDraft): Entry {
  return {
    id: '',
    term: draft.term,
    targetLang: draft.targetLang ?? null,
    replacementType: replacementTypeProto.fromProto(draft.replacementType) ?? ReplacementType.SUB,
    replacement: draft.replacement,
    alphabet: draft.alphabet ?? null,
    note: draft.note ?? null,
    isActive: draft.isActive ?? true,
    updatedAt: new Date(0).toISOString(),
  };
}
