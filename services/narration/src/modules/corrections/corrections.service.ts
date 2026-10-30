import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  LocalizationTargetType,
  OverrideStatus,
  SOURCE_LANGUAGE,
  SynthesisTrigger,
  zCorrectionInput,
  zLanguage,
  zLocalizationOverview,
  zCursorQuery,
  zUuidV7,
} from '@wayfare/contracts';
import type { AuditRecordPayload, Correction, LocalizationOverview } from '@wayfare/contracts';
import {
  audioStatusProto,
  localizationTargetTypeProto,
  translationSourceProto,
} from '@wayfare/contracts/grpc';
import type { catalogGrpc, narrationGrpc } from '@wayfare/contracts/grpc';
import {
  decodeCursor,
  encodeCursor,
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  requireProtoEnum,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import type { NarrationTx } from '../tasks/tasks.service';
import { fromOverrideColumnsRow, toCorrection, toProtoCorrection } from './correction.mapper';
import type { OverrideColumnsRow, OverrideRow } from './correction.mapper';
import { isListed, needsReview } from './domain/review';

const targetFields = z.object({ targetType: z.number(), targetId: zUuidV7 });
const langField = z.object({ lang: zLanguage });

/** The target as catalog holds it now: its text, its hash, and each language's state. */
interface Target {
  readonly type: LocalizationTargetType.PLACE | LocalizationTargetType.MENU_ITEM;
  readonly contentHash: string;
  readonly nameVi: string;
  readonly descriptionVi: string | null;
  readonly localizations: readonly catalogGrpc.LocalizationState[];
}

/**
 * Staff translation corrections (api-endpoints-plan §4.5, rdm-spec N-7, ADR 0050). The text is
 * narration's to hold and catalog's to publish: a correction is stored here, and the job it
 * creates re-voices the Place so its words and its audio change together.
 */
@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly catalog: CatalogServiceGrpcClient,
    private readonly jobs: JobsService,
    private readonly tasks: TasksService,
  ) {}

  /** The correction screen: what each language says now, and the correction held for it. */
  async getLocalizationOverview(
    request: narrationGrpc.GetLocalizationOverviewRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.GetLocalizationOverviewResponse> {
    requireAccountContext(context);
    const fields = parseRpcRequest(targetFields, request);
    const targetType = this.narratedTarget(fields.targetType);
    const target = await this.target(targetType, fields.targetId);
    // Each language's latest correction that still counts: in use, or superseded and waiting.
    const held = await this.prisma.localizationOverride.findMany({
      where: { targetType, targetId: fields.targetId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    const byLang = new Map<string, OverrideRow>();
    for (const row of held) if (!byLang.has(row.lang)) byLang.set(row.lang, row);
    for (const [lang, row] of byLang) if (!isListed(row)) byLang.delete(lang);
    const overview: LocalizationOverview = zLocalizationOverview.parse({
      targetType,
      targetId: fields.targetId,
      sourceContentHash: target.contentHash,
      nameVi: target.nameVi,
      descriptionVi: target.descriptionVi,
      languages: target.localizations.map((state) => ({
        lang: state.lang,
        name: state.name,
        description: state.description === '' ? null : state.description,
        translationSource: requireProtoEnum(
          translationSourceProto,
          state.translationSource,
          '/translationSource',
        ),
        audioStatus: requireProtoEnum(audioStatusProto, state.audioStatus, '/audioStatus'),
        correction: this.correctionOf(byLang.get(state.lang), target.contentHash),
        needsReview: (() => {
          const row = byLang.get(state.lang);
          return row !== undefined && needsReview(row, target.contentHash);
        })(),
      })),
    });
    return { overviewJson: JSON.stringify(overview) };
  }

  /**
   * The corrections across targets (api-endpoints-plan §4.5): each language's latest, kept when
   * in use or needing review, needing review first (or not), then newest. Each target's name and
   * current hash come from catalog, once per distinct target on the page.
   */
  async listCorrections(
    request: narrationGrpc.ListCorrectionsRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.ListCorrectionsResponse> {
    requireAccountContext(context);
    const page = parseRpcRequest(zCursorQuery, {
      cursor: request.page?.cursor,
      limit: request.page?.limit === 0 ? undefined : request.page?.limit,
    });
    const after = page.cursor === undefined ? null : decodeCursor(page.cursor);
    const position = after?.key === undefined ? null : readPosition(after.key);
    if (page.cursor !== undefined && (after === null || position === null)) {
      throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/cursor', code: 'invalid_value' }] });
    }
    // rank 0: needing review (superseded by the Vietnamese); 1: in use.
    const rank = request.reviewFirst
      ? Prisma.sql`CASE WHEN status = ${OverrideStatus.REVERTED} THEN 0 ELSE 1 END`
      : Prisma.sql`0`;
    const resume =
      after === null || position === null
        ? Prisma.empty
        : Prisma.sql`AND (rank > ${position.rank} OR (rank = ${position.rank} AND (updated_at < ${position.updatedAt} OR (updated_at = ${position.updatedAt} AND id < ${after.id}::uuid))))`;
    const rows = await this.prisma.$queryRaw<(OverrideColumnsRow & { rank: number })[]>`
      WITH latest AS (
        SELECT DISTINCT ON (target_type, target_id, lang) *
        FROM localization_overrides
        ORDER BY target_type, target_id, lang, updated_at DESC, id DESC
      ), kept AS (
        SELECT *, ${rank} AS rank FROM latest
        WHERE status = ${OverrideStatus.ACTIVE} OR reverted_by_id IS NULL
      )
      SELECT * FROM kept WHERE true ${resume}
      ORDER BY rank ASC, updated_at DESC, id DESC
      LIMIT ${page.limit + 1}`;
    const shown = rows.slice(0, page.limit).map(fromOverrideColumnsRow);
    const targets = new Map<string, Target | null>();
    for (const row of shown) {
      const key = `${row.targetType}:${row.targetId}`;
      if (targets.has(key)) continue;
      // ponytail: one catalog read per distinct target on a page (≤ 20); a batch RPC if it shows.
      targets.set(
        key,
        await this.target(
          row.targetType as LocalizationTargetType.PLACE | LocalizationTargetType.MENU_ITEM,
          row.targetId,
        ).catch(() => null),
      );
    }
    const last = rows.length > page.limit ? rows[page.limit - 1] : undefined;
    return {
      items: shown.map((row) => {
        const target = targets.get(`${row.targetType}:${row.targetId}`) ?? null;
        const currentHash = target?.contentHash ?? null;
        return {
          correction: toProtoCorrection(toCorrection(row, currentHash ?? row.sourceContentHash)),
          targetNameVi: target?.nameVi ?? '',
          needsReview: needsReview(row, currentHash),
        };
      }),
      page:
        last === undefined
          ? {}
          : {
              nextCursor: encodeCursor({
                id: last.id,
                key: `${last.rank}|${last.updated_at.toISOString()}`,
              }),
            },
    };
  }

  /**
   * `PUT …/:lang`: the correction is kept against the source version the editor saw. A stale hash
   * is `409`, so nobody corrects text that has moved on; `vi` is never corrected — it is the
   * source.
   */
  async putCorrection(
    request: narrationGrpc.PutCorrectionRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.PutCorrectionResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(targetFields, request);
    const { lang } = parseRpcRequest(langField, request);
    const input = parseRpcRequest(zCorrectionInput, {
      sourceContentHash: request.sourceContentHash,
      name: request.name,
      description: request.description ?? null,
    });
    const targetType = this.narratedTarget(fields.targetType);
    this.correctable(targetType, lang);
    const target = await this.target(targetType, fields.targetId);
    if (target.contentHash !== input.sourceContentHash)
      throw rpcError('LOCALIZATION_SOURCE_CHANGED');

    const row = await this.tasks.transact(async (tx, fx) => {
      // One ACTIVE correction per source version (N-7): the previous one for this version goes.
      await tx.localizationOverride.updateMany({
        where: {
          targetType,
          targetId: fields.targetId,
          lang,
          status: OverrideStatus.ACTIVE,
        },
        data: { status: OverrideStatus.REVERTED, revertedById: actor.userId },
      });
      const created = await tx.localizationOverride.create({
        data: {
          targetType,
          targetId: fields.targetId,
          lang,
          sourceContentHash: input.sourceContentHash,
          name: input.name,
          description: input.description ?? null,
          status: OverrideStatus.ACTIVE,
          editedById: actor.userId,
        },
      });
      await this.audit(tx, actor, AuditAction.LOCALIZATION_EDITED, created.id, {
        after: {
          targetType,
          targetId: fields.targetId,
          lang,
          sourceContentHash: input.sourceContentHash,
        },
      });
      await this.revoice(tx, fx, target, fields.targetId, lang, SynthesisTrigger.HUMAN_EDIT, actor);
      return created;
    });
    return { correction: this.wire(row, target.contentHash) };
  }

  /** `DELETE …/:lang`: the correction is retired and the machine translation comes back. */
  async revertCorrection(
    request: narrationGrpc.RevertCorrectionRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.RevertCorrectionResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(targetFields, request);
    const { lang } = parseRpcRequest(langField, request);
    const targetType = this.narratedTarget(fields.targetType);
    this.correctable(targetType, lang);
    const target = await this.target(targetType, fields.targetId);
    const active = await this.prisma.localizationOverride.findFirst({
      where: { targetType, targetId: fields.targetId, lang, status: OverrideStatus.ACTIVE },
    });
    if (active === null) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: AuditResourceType.LOCALIZATION });
    }
    await this.tasks.transact(async (tx, fx) => {
      await tx.localizationOverride.update({
        where: { id: active.id },
        data: { status: OverrideStatus.REVERTED, revertedById: actor.userId },
        select: { id: true },
      });
      await this.audit(tx, actor, AuditAction.LOCALIZATION_REVERTED, active.id, {
        before: { lang, sourceContentHash: active.sourceContentHash },
      });
      await this.revoice(
        tx,
        fx,
        target,
        fields.targetId,
        lang,
        SynthesisTrigger.HUMAN_REVERT,
        actor,
      );
    });
    return {};
  }

  /** The job that publishes the new words — with their audio, for a Place (rdm-spec N-7). */
  private async revoice(
    tx: NarrationTx,
    fx: Parameters<Parameters<TasksService['transact']>[0]>[1],
    target: Target,
    targetId: string,
    lang: string,
    trigger: SynthesisTrigger,
    actor: AccountContext,
  ): Promise<void> {
    await this.jobs.createJob(tx, fx, {
      targetType: target.type,
      targetId,
      sourceContentHash: target.contentHash,
      langs: [lang],
      includeAudio: target.type === LocalizationTargetType.PLACE,
      trigger,
      requestedByUserId: actor.userId,
    });
  }

  private correctionOf(row: OverrideRow | undefined, currentHash: string): Correction | null {
    return row === undefined ? null : toCorrection(row, currentHash);
  }

  private wire(row: OverrideRow, currentHash: string): narrationGrpc.Correction {
    return toProtoCorrection(toCorrection(row, currentHash));
  }

  /** `vi` is the source, and a voucher offer is never corrected (rdm-spec N-7). */
  private correctable(targetType: LocalizationTargetType, lang: string): void {
    if (lang === SOURCE_LANGUAGE) {
      throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/lang', code: 'source_language' }] });
    }
    if (
      targetType !== LocalizationTargetType.PLACE &&
      targetType !== LocalizationTargetType.MENU_ITEM
    ) {
      throw rpcError('VALIDATION_FAILED', {
        issues: [{ path: '/targetType', code: 'not_correctable' }],
      });
    }
  }

  private narratedTarget(
    value: number,
  ): LocalizationTargetType.PLACE | LocalizationTargetType.MENU_ITEM {
    const targetType = requireProtoEnum(localizationTargetTypeProto, value, '/targetType');
    if (
      targetType !== LocalizationTargetType.PLACE &&
      targetType !== LocalizationTargetType.MENU_ITEM
    ) {
      throw rpcError('VALIDATION_FAILED', {
        issues: [{ path: '/targetType', code: 'not_correctable' }],
      });
    }
    return targetType;
  }

  /** The target as catalog holds it now; one that is gone is `404` (api §12.2). */
  private async target(
    targetType: LocalizationTargetType.PLACE | LocalizationTargetType.MENU_ITEM,
    targetId: string,
  ): Promise<Target> {
    const response = await this.catalog.localizationSource(targetType, targetId);
    const place = response.place ?? null;
    if (place !== null && !place.deleted) {
      return {
        type: LocalizationTargetType.PLACE,
        contentHash: place.contentHash,
        nameVi: place.nameVi,
        descriptionVi: place.descriptionVi,
        localizations: place.localizations,
      };
    }
    const item = response.menuItem ?? null;
    if (item !== null) {
      return {
        type: LocalizationTargetType.MENU_ITEM,
        contentHash: item.contentHash,
        nameVi: item.nameVi,
        descriptionVi: item.descriptionVi ?? null,
        localizations: [],
      };
    }
    throw rpcError('LOCALIZATION_TARGET_UNAVAILABLE');
  }

  private async audit(
    tx: NarrationTx,
    actor: AccountContext,
    action: AuditAction,
    overrideId: string,
    metadata: AuditRecordPayload['metadata'],
  ): Promise<void> {
    await this.outbox.add(tx, AUDIT_RECORD, {
      occurredAt: new Date().toISOString(),
      service: 'narration',
      actor: { type: AuditActorType.USER, userId: actor.userId },
      action,
      resource: { type: AuditResourceType.LOCALIZATION, id: overrideId },
      metadata,
      ...(actor.origin.ip === null ? {} : { ip: actor.origin.ip }),
      ...(actor.origin.userAgent === null ? {} : { userAgent: actor.origin.userAgent }),
    });
  }
}

/** A list cursor's key: the row's rank and its last change. */
function readPosition(key: string): { rank: number; updatedAt: Date } | null {
  const [rank, at] = key.split('|');
  const updatedAt = new Date(at ?? '');
  if ((rank !== '0' && rank !== '1') || Number.isNaN(updatedAt.getTime())) return null;
  return { rank: Number(rank), updatedAt };
}
