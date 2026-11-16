// The pronunciation dictionary and its fan-out (api-endpoints-plan §4.4, rdm-spec N-5): the
// writes, the preview that stores nothing, and the property this whole feature rests on — an
// edited entry re-voices the texts that hold its term, and nothing else.
import {
  AUDIT_RECORD,
  AuditAction,
  LocalizationTargetType,
  MAX_PREVIEW_CHARS,
  ReplacementType,
  SynthesisTrigger,
} from '@wayfare/contracts';
import { localizationTargetTypeProto, replacementTypeProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSpeechProvider } from '../../src/providers/speech/fake.speech-provider';
import { outboxPayloads, testPrisma, truncateAll } from '../setup/database';
import { jobsOf, staff } from '../setup/fixtures';
import { narrationServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof narrationServices>;
const T = replacementTypeProto;

beforeEach(async () => {
  await truncateAll(prisma);
  services = narrationServices(prisma);
});
afterAll(() => prisma.$disconnect());

const draft = (
  over: Partial<narrationGrpc.PronunciationDraft> = {},
): narrationGrpc.PronunciationDraft => ({
  term: 'Bến Thành',
  targetLang: 'en',
  replacementType: T.toProto(ReplacementType.SUB),
  replacement: 'ben tahn',
  note: 'sample',
  ...over,
});

const create = (over: Partial<narrationGrpc.PronunciationDraft> = {}) =>
  services.pronunciations.createEntry({ entry: draft(over) }, staff());

const audits = async (action: AuditAction) =>
  (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter((row) => row.action === action);

describe('the dictionary', () => {
  it('creates, lists, edits and deletes, refusing a term twice in one language', async () => {
    const { entry } = await create();
    expect(entry).toMatchObject({ term: 'Bến Thành', targetLang: 'en', isActive: true });
    expect(await audits(AuditAction.PRONUNCIATION_CREATED)).toEqual([
      expect.objectContaining({
        resource: { type: 'PRONUNCIATION', id: entry!.id },
        metadata: {
          after: { term: 'Bến Thành', targetLang: 'en', replacementType: 'SUB', isActive: true },
        },
      }),
    ]);

    const taken = await errorOf(create());
    expect(taken).toEqual({
      code: 'PRONUNCIATION_TERM_EXISTS',
      details: { term: 'Bến Thành', targetLang: 'en' },
    });
    // The same term for every language is a different entry (N-5's two partial uniques).
    await create({ targetLang: undefined });
    expect((await errorOf(create({ targetLang: undefined }))).code).toBe(
      'PRONUNCIATION_TERM_EXISTS',
    );

    const { entries } = await services.pronunciations.listEntries({ page: undefined }, staff());
    expect(entries).toHaveLength(2);
    const { entry: edited } = await services.pronunciations.updateEntry(
      { entryId: entry!.id, replacement: 'bun tahn', isActive: false },
      staff(),
    );
    expect(edited).toMatchObject({ replacement: 'bun tahn', isActive: false });

    await services.pronunciations.deleteEntry({ entryId: entry!.id }, staff());
    expect(await prisma.pronunciationEntry.count()).toBe(1);
    expect(await audits(AuditAction.PRONUNCIATION_DELETED)).toEqual([
      expect.objectContaining({ metadata: { before: { term: 'Bến Thành', targetLang: 'en' } } }),
    ]);
  });

  it('refuses a PHONEME entry with no alphabet, and a SUB entry with one', async () => {
    const phoneme = await errorOf(create({ replacementType: T.toProto(ReplacementType.PHONEME) }));
    expect(phoneme.details).toMatchObject({
      issues: [expect.objectContaining({ path: '/alphabet' })],
    });
    const sub = await errorOf(create({ alphabet: 'ipa' }));
    expect(sub.details).toMatchObject({ issues: [expect.objectContaining({ path: '/alphabet' })] });
    expect(
      (await create({ replacementType: T.toProto(ReplacementType.PHONEME), alphabet: 'ipa' }))
        .entry,
    ).toMatchObject({ alphabet: 'ipa' });
  });
});

describe('preview', () => {
  const preview = (over: Partial<narrationGrpc.PreviewAudioRequest> = {}) =>
    services.pronunciations.previewAudio(
      { text: 'Chợ Bến Thành mở cửa.', lang: 'en', entries: [], ...over },
      staff(),
    );

  it('synthesizes the sentence with the draft entry and stores nothing', async () => {
    const synthesize = vi.spyOn(FakeSpeechProvider.prototype, 'synthesize');
    const { audio, contentType } = await preview({ entries: [draft()] });
    expect(audio.length).toBeGreaterThan(0);
    expect(contentType).toBe('audio/mpeg');
    // The draft's alias reached the provider, and nothing was written.
    expect(synthesize.mock.calls[0]![0].ssml).toContain('<sub alias="ben tahn">Bến Thành</sub>');
    expect(await prisma.audioAsset.count()).toBe(0);
    expect(services.storage.objects.size).toBe(0);
    synthesize.mockRestore();
  });

  it('applies the saved dictionary too, and refuses a language with no voice or text too long', async () => {
    await create({ replacement: 'saved alias' });
    const synthesize = vi.spyOn(FakeSpeechProvider.prototype, 'synthesize');
    await preview();
    expect(synthesize.mock.calls[0]![0].ssml).toContain('saved alias');
    synthesize.mockRestore();

    expect((await errorOf(preview({ lang: 'vi' }))).code).toBe('INVALID_STATE');
    expect((await errorOf(preview({ text: 'x'.repeat(MAX_PREVIEW_CHARS + 1) }))).code).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('the fan-out', () => {
  const match = (targetId: string, lang = 'en', hash = 'a'.repeat(64)) => ({
    targetType: localizationTargetTypeProto.toProto(LocalizationTargetType.PLACE),
    targetId,
    lang,
    sourceContentHash: hash,
  });

  it('creates one job per target, in the entry\u2019s languages, and none for a text without the term', async () => {
    const withTerm = services.catalog.place({ name: 'Chợ Bến Thành' });
    const other = services.catalog.place({ name: 'Nhà hát' });
    services.catalog.matches.set('Bến Thành', [
      match(withTerm.id, 'en', withTerm.hash),
      match(withTerm.id, 'ja', withTerm.hash),
    ]);

    // An `en` entry changes how English is read, and nothing else.
    await create();
    await services.fanoutQueue.drain();
    const [job] = await jobsOf(prisma, withTerm.id);
    expect(job!.trigger).toBe(SynthesisTrigger.DICTIONARY_CHANGED);
    expect(job!.tasks.map((task) => task.lang)).toEqual(['en']);
    expect(await jobsOf(prisma, other.id)).toEqual([]);

    // An entry for every language takes both of the target's rows into one job.
    await create({ term: 'Sài Gòn', targetLang: undefined });
    services.catalog.matches.set('Sài Gòn', [
      match(withTerm.id, 'en', withTerm.hash),
      match(withTerm.id, 'ja', withTerm.hash),
    ]);
    services.fanoutQueue.items.length = 0;
    await services.fanout.enqueue('Sài Gòn', null);
    await services.fanoutQueue.drain();
    const jobs = await jobsOf(prisma, withTerm.id);
    expect(
      jobs
        .at(-1)!
        .tasks.map((task) => task.lang)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['en', 'ja']);
  });

  it('fans out on an edit and on a delete, with the term as it was', async () => {
    const place = services.catalog.place();
    services.catalog.matches.set('Bến Thành', [match(place.id, 'en', place.hash)]);
    const { entry } = await create();
    await services.fanoutQueue.drain();

    await services.pronunciations.updateEntry(
      { entryId: entry!.id, replacement: 'other' },
      staff(),
    );
    expect(services.fanoutQueue.items.map(({ item }) => item.term)).toEqual(['Bến Thành']);
    await services.fanoutQueue.drain();

    await services.pronunciations.deleteEntry({ entryId: entry!.id }, staff());
    expect(services.fanoutQueue.items.map(({ item }) => item.term)).toEqual(['Bến Thành']);
    await services.fanoutQueue.drain();
    // Three jobs for the same text, and one task doing the work: the later ones coalesced into it
    // (rdm-spec N-1), so a term saved twice costs one synthesis.
    const jobs = await jobsOf(prisma, place.id);
    expect(jobs).toHaveLength(3);
    const tasks = jobs.flatMap((job) => job.tasks);
    expect(tasks.filter((task) => task.coalescedIntoTaskId !== null)).toHaveLength(2);
  });

  it('saving the same entry again re-voices nothing: the audio is already cached', async () => {
    const place = services.catalog.place({ name: 'Ch\u1ee3 B\u1ebfn Th\u00e0nh' });
    services.catalog.matches.set('B\u1ebfn Th\u00e0nh', [match(place.id, 'en', place.hash)]);
    const { entry } = await create();
    await services.fanoutQueue.drain();
    await services.queue.drain();
    const assets = await prisma.audioAsset.count();
    expect(assets).toBeGreaterThan(0);

    // The same note saved twice changes no text, so the audio cache key is the one already stored
    // (rdm-spec N-3): the fan-out runs again and the provider is never asked.
    const synthesize = vi.spyOn(FakeSpeechProvider.prototype, 'synthesize');
    await services.pronunciations.updateEntry({ entryId: entry!.id, note: 'again' }, staff());
    await services.fanoutQueue.drain();
    await services.queue.drain();
    expect(await prisma.audioAsset.count()).toBe(assets);
    expect(synthesize).not.toHaveBeenCalled();
    synthesize.mockRestore();
  });

  it('retries a failed page from its cursor, without repeating the work', async () => {
    const first = services.catalog.place();
    const second = services.catalog.place();
    services.catalog.matches.set('Bến Thành', [
      match(first.id, 'en', first.hash),
      match(second.id, 'en', second.hash),
    ]);
    await create();
    // The first page answers, the second fails: the retry starts where it left off.
    services.catalog.searchFailures = 1;
    const queued = services.fanoutQueue.items.map(({ item }) => item);
    services.fanoutQueue.items.length = 0;
    await services.fanout.run({ ...queued[0]!, cursor: '1', done: 1 });
    expect(services.fanoutQueue.items[0]!.item).toMatchObject({ cursor: '1', done: 1, attempt: 2 });
    await services.fanoutQueue.drain();
    expect(await jobsOf(prisma, second.id)).toHaveLength(1);
  });
});

/** A failed call's code and details. */
async function errorOf(promise: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (caught: unknown) => caught,
  );
  const rpc = error as { getError?: () => { metadata: { get(key: string): unknown[] } } };
  if (typeof rpc.getError !== 'function') throw error;
  const metadata = rpc.getError().metadata;
  const details = metadata.get('wf-error-details')[0];
  return {
    code: String(metadata.get('wf-error-code')[0]),
    details: typeof details === 'string' ? (JSON.parse(details) as unknown) : undefined,
  };
}
