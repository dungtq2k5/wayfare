import { Injectable, StreamableFile } from '@nestjs/common';
import type { PronunciationEntry } from '@wayfare/contracts';
import { Paged } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
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
  constructor(private readonly narration: NarrationServiceGrpcClient) {}

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
      response.entries.map(toPronunciationEntry),
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
    return { entry: toPronunciationEntry(response.entry) };
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
    return { entry: toPronunciationEntry(response.entry) };
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
