import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  ReplacementType,
  SOURCE_LANGUAGE,
  zPreviewInput,
  zPronunciationInput,
  zPronunciationQuery,
  zPronunciationUpdateInput,
  zUuidV7,
} from '@wayfare/contracts';
import type { AuditRecordPayload, PronunciationInput } from '@wayfare/contracts';
import { replacementTypeProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import {
  decodeCursor,
  encodeCursor,
  isUniqueConstraintViolation,
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { voiceFor } from '../../config/voices';
import { InputRefusedError } from '../../providers/provider-chain';
import { DictionaryFanoutService } from '../dictionary-fanout/dictionary-fanout.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersHealthService } from '../providers-health/providers-health.service';
import { applyDictionary, escapeXml, splitSsml } from '../tasks/domain/ssml';
import type { PronunciationRule } from '../tasks/domain/ssml';
import type { NarrationTx } from '../tasks/tasks.service';
import { toPronunciationEntry } from './pronunciation.mapper';
import type { PronunciationRow } from './pronunciation.mapper';

const entryIdField = z.object({ entryId: zUuidV7 });

/** A draft entry as the pipeline's dictionary reads it. */
const asRule = (draft: narrationGrpc.PronunciationDraft): PronunciationRule => ({
  term: draft.term,
  targetLang: draft.targetLang ?? null,
  replacementType:
    (replacementTypeProto.fromProto(draft.replacementType) ?? ReplacementType.SUB) ===
    ReplacementType.PHONEME
      ? 'PHONEME'
      : 'SUB',
  replacement: draft.replacement,
  alphabet: draft.alphabet ?? null,
});

/**
 * The pronunciation dictionary (api-endpoints-plan §4.4, rdm-spec N-5). Every write fans out on a
 * queue: the term decides which texts sound different, and those re-synthesize on their own. A
 * preview synthesizes one sentence and keeps nothing — a draft's audio must never reach the cache.
 */
@Injectable()
export class PronunciationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly providers: ProvidersHealthService,
    private readonly fanout: DictionaryFanoutService,
  ) {}

  async listEntries(
    request: narrationGrpc.ListEntriesRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.ListEntriesResponse> {
    requireAccountContext(context);
    const query = parseRpcRequest(zPronunciationQuery, {
      cursor: request.page?.cursor,
      limit: request.page?.limit === 0 ? undefined : request.page?.limit,
      q: request.q,
      targetLang: request.targetLang,
    });
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
    if (query.cursor !== undefined && (after?.key === undefined)) {
      throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/cursor', code: 'invalid_value' }] });
    }
    const rows = await this.prisma.pronunciationEntry.findMany({
      where: {
        ...(query.q === undefined ? {} : { term: { contains: query.q, mode: 'insensitive' } }),
        ...(query.targetLang === undefined ? {} : { targetLang: query.targetLang }),
        ...(after === null
          ? {}
          : { OR: [{ term: { gt: after.key! } }, { term: after.key!, id: { gt: after.id } }] }),
      },
      orderBy: [{ term: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      entries: page.map(toPronunciationEntry),
      page: {
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeCursor({ id: last.id, key: last.term })
            : undefined,
      },
    };
  }

  async createEntry(
    request: narrationGrpc.CreateEntryRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.CreateEntryResponse> {
    const actor = requireAccountContext(context);
    const draft = request.entry;
    const input = parseRpcRequest(zPronunciationInput, {
      term: draft?.term,
      targetLang: draft?.targetLang ?? null,
      replacementType:
        draft === undefined
          ? undefined
          : (replacementTypeProto.fromProto(draft.replacementType) ?? undefined),
      replacement: draft?.replacement,
      alphabet: draft?.alphabet ?? null,
      note: draft?.note ?? null,
      isActive: draft?.isActive,
    });
    const row = await this.write(input, actor);
    await this.fanout.enqueue(row.term, row.targetLang);
    return { entry: toPronunciationEntry(row) };
  }

  async updateEntry(
    request: narrationGrpc.UpdateEntryRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.UpdateEntryResponse> {
    const actor = requireAccountContext(context);
    const { entryId } = parseRpcRequest(entryIdField, request);
    const current = await this.entry(entryId);
    const input = parseRpcRequest(zPronunciationUpdateInput, {
      replacementType:
        request.replacementType === undefined
          ? undefined
          : (replacementTypeProto.fromProto(request.replacementType) ?? undefined),
      replacement: request.replacement,
      alphabet: request.alphabet === undefined ? undefined : (request.alphabet ?? null),
      note: request.note === undefined ? undefined : (request.note ?? null),
      isActive: request.isActive,
      // The check needs the type even when only the alphabet moved.
      ...(request.replacementType === undefined
        ? { replacementType: current.replacementType as ReplacementType }
        : {}),
    });
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.pronunciationEntry.update({
        where: { id: entryId },
        data: {
          ...(input.replacementType === undefined
            ? {}
            : { replacementType: input.replacementType }),
          ...(input.replacement === undefined ? {} : { replacement: input.replacement }),
          ...(input.alphabet === undefined ? {} : { alphabet: input.alphabet }),
          ...(input.note === undefined ? {} : { note: input.note }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          updatedById: actor.userId,
        },
      });
      await this.audit(tx, actor, AuditAction.PRONUNCIATION_UPDATED, updated.id, {
        after: {
          term: updated.term,
          targetLang: updated.targetLang,
          replacementType: updated.replacementType,
          isActive: updated.isActive,
        },
      });
      return updated;
    });
    await this.fanout.enqueue(row.term, row.targetLang);
    return { entry: toPronunciationEntry(row) };
  }

  /** Hard-deleted (rdm-spec N-5); the audit row keeps the history, and the term fans out. */
  async deleteEntry(
    request: narrationGrpc.DeleteEntryRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.DeleteEntryResponse> {
    const actor = requireAccountContext(context);
    const { entryId } = parseRpcRequest(entryIdField, request);
    const row = await this.entry(entryId);
    await this.prisma.$transaction(async (tx) => {
      await tx.pronunciationEntry.delete({ where: { id: entryId }, select: { id: true } });
      await this.audit(tx, actor, AuditAction.PRONUNCIATION_DELETED, entryId, {
        before: { term: row.term, targetLang: row.targetLang },
      });
    });
    await this.fanout.enqueue(row.term, row.targetLang);
    return {};
  }

  /**
   * "Does it sound right now?" — one sentence, with the saved dictionary plus the request's draft
   * entries, synthesized and handed back. Nothing is stored: a draft's audio in the cache would be
   * served to tourists as though someone had approved it.
   */
  async previewAudio(
    request: narrationGrpc.PreviewAudioRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.PreviewAudioResponse> {
    requireAccountContext(context);
    const input = parseRpcRequest(zPreviewInput, {
      text: request.text,
      lang: request.lang,
      entries: request.entries.map((draft) => ({
        term: draft.term,
        targetLang: draft.targetLang ?? null,
        replacementType: replacementTypeProto.fromProto(draft.replacementType) ?? undefined,
        replacement: draft.replacement,
        alphabet: draft.alphabet ?? null,
        note: draft.note ?? null,
      })),
    });
    const lang = input.lang.lang;
    if (lang === null || lang === SOURCE_LANGUAGE) {
      throw rpcError('INVALID_STATE', { status: 'NO_VOICE' });
    }
    const rules = [...(await this.savedRules(lang)), ...request.entries.map(asRule)];
    const body = applyDictionary(escapeXml(input.text.normalize('NFC')), rules);
    const speakers = this.providers.chains.speech.providers.filter(
      (provider) => voiceFor(provider.name, lang) !== null,
    );
    if (speakers.length === 0) throw rpcError('INVALID_STATE', { status: 'NO_VOICE' });

    const { result, provider } = await this.providers.chains.speech.run(
      (candidate) => voiceFor(candidate.name, lang) !== null,
      async (candidate) => {
        const voice = voiceFor(candidate.name, lang)!;
        const split = splitSsml(body, candidate.maxInputBytes);
        if (!split.ok) throw new InputRefusedError(split.reason);
        const parts: Buffer[] = [];
        for (const ssml of split.chunks) parts.push(await candidate.synthesize({ ssml, voice }));
        return Buffer.concat(parts);
      },
    );
    return {
      audio: result,
      contentType: provider.format.startsWith('mp3') ? 'audio/mpeg' : 'audio/*',
    };
  }

  /** The saved entries that apply to `lang` (rdm-spec N-5). */
  private async savedRules(lang: string): Promise<PronunciationRule[]> {
    const rows = await this.prisma.pronunciationEntry.findMany({
      where: { isActive: true, OR: [{ targetLang: lang }, { targetLang: null }] },
      select: {
        term: true,
        targetLang: true,
        replacementType: true,
        replacement: true,
        alphabet: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      replacementType: row.replacementType as 'SUB' | 'PHONEME',
    }));
  }

  private async entry(entryId: string): Promise<PronunciationRow> {
    const row = await this.prisma.pronunciationEntry.findUnique({ where: { id: entryId } });
    if (row === null) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: AuditResourceType.PRONUNCIATION });
    }
    return row;
  }

  /** Inserts the entry, or reports the term and language that already hold it (N-5's uniques). */
  private async write(input: PronunciationInput, actor: AccountContext): Promise<PronunciationRow> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.pronunciationEntry.create({
          data: {
            term: input.term,
            targetLang: input.targetLang ?? null,
            replacementType: input.replacementType,
            replacement: input.replacement,
            alphabet: input.alphabet ?? null,
            note: input.note ?? null,
            isActive: input.isActive ?? true,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        await this.audit(tx, actor, AuditAction.PRONUNCIATION_CREATED, created.id, {
          after: {
            term: created.term,
            targetLang: created.targetLang,
            replacementType: created.replacementType,
            isActive: created.isActive,
          },
        });
        return created;
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw rpcError('PRONUNCIATION_TERM_EXISTS', {
          term: input.term,
          targetLang: input.targetLang ?? null,
        });
      }
      throw error;
    }
  }

  /** `audit.record` for a dictionary write (api-endpoints-plan §4.4, rdm-spec I-11). */
  private async audit(
    tx: NarrationTx,
    actor: AccountContext,
    action: AuditAction,
    entryId: string,
    metadata: AuditRecordPayload['metadata'],
  ): Promise<void> {
    await this.outbox.add(tx, AUDIT_RECORD, {
      occurredAt: new Date().toISOString(),
      service: 'narration',
      actor: { type: AuditActorType.USER, userId: actor.userId },
      action,
      resource: { type: AuditResourceType.PRONUNCIATION, id: entryId },
      metadata,
      ...(actor.origin.ip === null ? {} : { ip: actor.origin.ip }),
      ...(actor.origin.userAgent === null ? {} : { userAgent: actor.origin.userAgent }),
    });
  }
}
