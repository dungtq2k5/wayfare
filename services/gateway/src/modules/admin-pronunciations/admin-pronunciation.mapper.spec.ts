import { ReplacementType } from '@wayfare/contracts';
import { replacementTypeProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import {
  toPronunciationDraft,
  toPronunciationEntry,
  toUpdateEntryRequest,
} from './admin-pronunciation.mapper';

const nameOf = (id: string) => ({ id, name: null });
const entry = (over: Partial<narrationGrpc.PronunciationEntry> = {}) =>
  ({
    id: 'e1',
    term: 'Huế',
    replacementType: replacementTypeProto.toProto(ReplacementType.SUB),
    replacement: 'Hway',
    isActive: true,
    updatedAt: toProtoTimestamp(new Date('2026-05-01T00:00:00.000Z')),
    updatedById: 'u1',
    ...over,
  }) as narrationGrpc.PronunciationEntry;

describe('a dictionary entry for the console', () => {
  it('reads absent language, alphabet and note as null, and names the editor by the rule', () => {
    expect(toPronunciationEntry(entry(), nameOf)).toMatchObject({
      targetLang: null,
      alphabet: null,
      note: null,
      replacementType: ReplacementType.SUB,
      updatedBy: { id: 'u1', name: null },
    });
    expect(
      toPronunciationEntry(entry({ targetLang: 'en', alphabet: 'ipa', note: 'n' }), nameOf),
    ).toMatchObject({ targetLang: 'en', alphabet: 'ipa', note: 'n' });
  });

  it('refuses no entry, and a replacement type this build doesn’t know', () => {
    expect(() => toPronunciationEntry(undefined, nameOf)).toThrow('narration sent no entry');
    expect(() => toPronunciationEntry(entry({ replacementType: 99 as never }), nameOf)).toThrow(
      'narration sent an unknown type: 99',
    );
  });
});

describe('the writes', () => {
  it('a draft sends only the optional parts given', () => {
    const input = { term: 'Huế', replacementType: ReplacementType.PHONEME, replacement: 'hwe' };
    expect(toPronunciationDraft(input)).toEqual({
      term: 'Huế',
      replacementType: replacementTypeProto.toProto(ReplacementType.PHONEME),
      replacement: 'hwe',
    });
    expect(
      toPronunciationDraft({
        ...input,
        targetLang: 'en',
        alphabet: 'ipa',
        note: 'n',
        isActive: false,
      }),
    ).toMatchObject({ targetLang: 'en', alphabet: 'ipa', note: 'n', isActive: false });
  });

  it('an update sends only what the body carries; a null alphabet or note is left out', () => {
    expect(toUpdateEntryRequest('e1', { alphabet: null, note: null })).toEqual({ entryId: 'e1' });
    expect(
      toUpdateEntryRequest('e1', {
        replacementType: ReplacementType.SUB,
        replacement: 'x',
        alphabet: 'ipa',
        note: 'n',
        isActive: true,
      }),
    ).toEqual({
      entryId: 'e1',
      replacementType: replacementTypeProto.toProto(ReplacementType.SUB),
      replacement: 'x',
      alphabet: 'ipa',
      note: 'n',
      isActive: true,
    });
  });
});
