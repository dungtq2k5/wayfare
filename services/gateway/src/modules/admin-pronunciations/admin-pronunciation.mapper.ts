import type { ReplacementType, PronunciationEntry, PronunciationInput } from '@wayfare/contracts';
import { replacementTypeProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { fromProtoTimestamp } from '@wayfare/nest-common';
import type { UpdatePronunciationDto } from './dto/admin-pronunciation.dto';

/** An entry's replacement type; an unknown value is a narration newer than this gateway. */
function typeOf(value: number): ReplacementType {
  const replacementType = replacementTypeProto.fromProto(value);
  if (replacementType === null) throw new Error(`narration sent an unknown type: ${value}`);
  return replacementType;
}

/** A dictionary entry as the console lists it. */
export function toPronunciationEntry(
  entry: narrationGrpc.PronunciationEntry | undefined,
): PronunciationEntry {
  if (entry === undefined) throw new Error('narration sent no entry');
  return {
    id: entry.id,
    term: entry.term,
    targetLang: entry.targetLang ?? null,
    replacementType: typeOf(entry.replacementType),
    replacement: entry.replacement,
    alphabet: entry.alphabet ?? null,
    note: entry.note ?? null,
    isActive: entry.isActive,
    updatedAt: fromProtoTimestamp(entry.updatedAt, 'updatedAt').toISOString(),
  };
}

/** One entry a write or a preview states. */
export function toPronunciationDraft(input: PronunciationInput): narrationGrpc.PronunciationDraft {
  return {
    term: input.term,
    ...(input.targetLang == null ? {} : { targetLang: input.targetLang }),
    replacementType: replacementTypeProto.toProto(input.replacementType),
    replacement: input.replacement,
    ...(input.alphabet == null ? {} : { alphabet: input.alphabet }),
    ...(input.note == null ? {} : { note: input.note }),
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
  };
}

/** The `UpdateEntry` request: only what the body carries. */
export function toUpdateEntryRequest(
  entryId: string,
  body: UpdatePronunciationDto,
): narrationGrpc.UpdateEntryRequest {
  return {
    entryId,
    ...(body.replacementType === undefined
      ? {}
      : { replacementType: replacementTypeProto.toProto(body.replacementType) }),
    ...(body.replacement === undefined ? {} : { replacement: body.replacement }),
    ...(body.alphabet == null ? {} : { alphabet: body.alphabet }),
    ...(body.note == null ? {} : { note: body.note }),
    ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
  };
}
