import { Injectable, StreamableFile } from '@nestjs/common';
import type { PronunciationEntry } from '@wayfare/contracts';
import { Paged } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { PeopleNamesService } from '../people-names/people-names.service';
import { NarrationServiceGrpcClient } from '../narration-client/narration-service-grpc.client';
import {
  toPronunciationDraft,
  toPronunciationEntry,
  toUpdateEntryRequest,
} from './admin-pronunciation.mapper';
import type {
  CreatePronunciationDto,
  PreviewPronunciationDto,
  PronunciationsQueryDto,
  UpdatePronunciationDto,
} from './dto/admin-pronunciation.dto';

/** A preview is a speech call, not a database read: it gets the time one takes. */
export const PREVIEW_DEADLINE_MS = 30_000;

/** `/admin/narration/pronunciations`, backed by `narration.PronunciationService`. */
@Injectable()
export class AdminPronunciationsService {
  constructor(
    private readonly narration: NarrationServiceGrpcClient,
    private readonly people: PeopleNamesService,
  ) {}

  /** Entries with their last changers named by the rule, in one identity call. */
  private async named(
    context: AccountContext,
    entries: readonly (narrationGrpc.PronunciationEntry | undefined)[],
  ): Promise<PronunciationEntry[]> {
    const nameOf = await this.people.of(
      context,
      entries.map((entry) => entry?.updatedById),
    );
    return entries.map((entry) => toPronunciationEntry(entry, nameOf));
  }

  async get(context: AccountContext, entryId: string): Promise<{ entry: PronunciationEntry }> {
    const response = await this.narration.pronunciations.call('getEntry', { entryId }, context);
    const [entry] = await this.named(context, [response.entry]);
    return { entry: entry! };
  }

  async list(
    context: AccountContext,
    query: PronunciationsQueryDto,
  ): Promise<Paged<PronunciationEntry>> {
    const response = await this.narration.pronunciations.call(
      'listEntries',
      {
        page: { cursor: query.cursor, limit: query.limit },
        ...(query.q === undefined ? {} : { q: query.q }),
        ...(query.targetLang === undefined ? {} : { targetLang: query.targetLang }),
      },
      context,
    );
    return Paged.cursor(
      await this.named(context, response.entries),
      response.page?.nextCursor ?? null,
    );
  }

  async create(
    context: AccountContext,
    body: CreatePronunciationDto,
  ): Promise<{ entry: PronunciationEntry }> {
    const response = await this.narration.pronunciations.call(
      'createEntry',
      { entry: toPronunciationDraft(body) },
      context,
    );
    const [entry] = await this.named(context, [response.entry]);
    return { entry: entry! };
  }

  async update(
    context: AccountContext,
    entryId: string,
    body: UpdatePronunciationDto,
  ): Promise<{ entry: PronunciationEntry }> {
    const response = await this.narration.pronunciations.call(
      'updateEntry',
      toUpdateEntryRequest(entryId, body),
      context,
    );
    const [entry] = await this.named(context, [response.entry]);
    return { entry: entry! };
  }

  async remove(context: AccountContext, entryId: string): Promise<void> {
    await this.narration.pronunciations.call('deleteEntry', { entryId }, context);
  }

  /** The audio itself, streamed back unwrapped and stored nowhere. */
  async preview(context: AccountContext, body: PreviewPronunciationDto): Promise<StreamableFile> {
    const response = await this.narration.pronunciations.call(
      'previewAudio',
      {
        text: body.text,
        lang: body.lang.tag,
        entries: (body.entries ?? []).map(toPronunciationDraft),
      },
      context,
      { deadlineMs: PREVIEW_DEADLINE_MS },
    );
    return new StreamableFile(Buffer.from(response.audio), {
      type: response.contentType,
      disposition: 'inline',
    });
  }
}
