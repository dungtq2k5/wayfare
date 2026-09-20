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
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  requireProtoEnum,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import type { NarrationTx } from '../tasks/tasks.service';
import { toCorrection, toProtoCorrection } from './correction.mapper';
import type { OverrideRow } from './correction.mapper';

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
    const held = await this.prisma.localizationOverride.findMany({
      where: {
        targetType,
        targetId: fields.targetId,
        status: OverrideStatus.ACTIVE,
      },
      orderBy: { lang: 'asc' },
    });
    const byLang = new Map(held.map((row) => [row.lang, row]));
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
      })),
    });
    return { overviewJson: JSON.stringify(overview) };
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
