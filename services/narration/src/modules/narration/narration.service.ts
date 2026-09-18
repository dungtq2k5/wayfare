import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  AuditActorType,
  LocalizationTargetType,
  MAX_LANGUAGE_CODE_LENGTH,
  normalizeLang,
  ON_DEMAND_RETRY_AFTER_MS,
  OnDemandStatus,
  PlaceKind,
  PlaceStatus,
  SynthesisTaskStatus,
  SynthesisTrigger,
  zUuidV7,
} from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';
import {
  audioStatusProto,
  onDemandStatusProto,
  placeKindProto,
  placeStatusProto,
} from '@wayfare/contracts/grpc';
import type { catalogGrpc, narrationGrpc } from '@wayfare/contracts/grpc';
import { servedAudio } from '@wayfare/core';
import { parseRpcRequest, requireDeviceContext, rpcError } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Env } from '../../config/env.schema';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { LIVE_JOB_STATUSES } from '../jobs/domain/job-status';
import { JobsService } from '../jobs/jobs.service';
import { TasksService } from '../tasks/tasks.service';

const placeLangFields = z.object({
  placeId: zUuidV7,
  // Any tag as sent: an unserved language is an answer, not an error (api-endpoints-plan §0.6).
  lang: z.string().min(1).max(MAX_LANGUAGE_CODE_LENGTH),
});

/** The tasks an on-demand request joins rather than duplicates (api-endpoints-plan §4.1). */
const JOINABLE_TASK_STATUSES = [
  SynthesisTaskStatus.QUEUED,
  SynthesisTaskStatus.RUNNING,
  SynthesisTaskStatus.COALESCED,
];

/** A stored object's public URL: the media base, then the path (api-endpoints-plan §0.7). */
function audioUrl(publicBaseUrl: string, objectPath: string): string {
  return `${publicBaseUrl}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
}

/** A catalog row's served audio, by the same rule as catalog's own reads (rdm-spec C-4). */
function servedOf(row: catalogGrpc.LocalizationState) {
  return servedAudio({
    sourceContentHash: row.sourceContentHash,
    audioStatus: audioStatusProto.fromProto(row.audioStatus) ?? '',
    audioSourceContentHash: row.audioSourceContentHash ?? null,
    audioObjectPath: row.audioObjectPath ?? null,
    audioSha256: row.audioSha256 ?? null,
    audioBytes: row.audioBytes ?? null,
    audioDurationMs: row.audioDurationMs ?? null,
  });
}

/**
 * A tourist device's narration routes (api-endpoints-plan §4.1): a Place's narration status in one
 * language, and on-demand synthesis of a language not ready yet — one live job per Place, language
 * and text, however many devices ask.
 */
@Injectable()
export class NarrationService {
  private readonly mediaBase: string;

  constructor(
    private readonly catalog: CatalogServiceGrpcClient,
    private readonly jobs: JobsService,
    private readonly tasks: TasksService,
    config: ConfigService<Env, true>,
  ) {
    this.mediaBase = config.get('GCS_PUBLIC_BASE_URL', { infer: true });
  }

  async getNarrationStatus(
    request: narrationGrpc.GetNarrationStatusRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.GetNarrationStatusResponse> {
    requireDeviceContext(context);
    const fields = parseRpcRequest(placeLangFields, request);
    const place = await this.activePlace(fields.placeId);
    const lang = normalizeLang(fields.lang);
    const row =
      lang === null ? undefined : place.localizations.find((state) => state.lang === lang);
    if (row === undefined) return { textReady: false, audio: undefined, stale: false };
    const audio = servedOf(row);
    return {
      textReady: true,
      audioStatus: row.audioStatus,
      audio:
        audio === null ? undefined : { ...audio, url: audioUrl(this.mediaBase, audio.objectPath) },
      stale: row.sourceContentHash !== place.contentHash,
    };
  }

  async requestOnDemand(
    request: narrationGrpc.RequestOnDemandRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.RequestOnDemandResponse> {
    const deviceId = requireDeviceContext(context);
    const fields = parseRpcRequest(placeLangFields, request);
    const place = await this.activePlace(fields.placeId);
    const lang = normalizeLang(fields.lang);
    if (lang === null) return this.answer(OnDemandStatus.UNAVAILABLE);
    // A Venue's languages are its plan's: fail closed until billing answers (api-endpoints-plan §12.2).
    if (placeKindProto.fromProto(place.kind) === PlaceKind.VENUE)
      throw rpcError('ENTITLEMENTS_UNAVAILABLE');

    const row = place.localizations.find((state) => state.lang === lang);
    const audio =
      row === undefined || row.sourceContentHash !== place.contentHash ? null : servedOf(row);
    if (audio !== null) {
      return {
        ...this.answer(OnDemandStatus.READY),
        audio: { ...audio, url: audioUrl(this.mediaBase, audio.objectPath) },
      };
    }

    const jobId = await this.tasks.transact(async (tx, fx) => {
      const key = {
        targetType: LocalizationTargetType.PLACE as const,
        targetId: fields.placeId,
        lang,
        sourceContentHash: place.contentHash,
      };
      await this.tasks.lockKey(tx, key);
      const joined = await tx.synthesisTask.findFirst({
        where: {
          ...key,
          status: { in: JOINABLE_TASK_STATUSES },
          job: { trigger: SynthesisTrigger.ON_DEMAND, status: { in: [...LIVE_JOB_STATUSES] } },
        },
        select: { jobId: true },
      });
      if (joined !== null) return joined.jobId;
      const id = await this.jobs.createJob(tx, fx, {
        ...key,
        langs: [lang],
        includeAudio: true,
        trigger: SynthesisTrigger.ON_DEMAND,
        requestedByDeviceId: deviceId,
      });
      await this.jobs.audit(tx, { type: AuditActorType.DEVICE, deviceId }, context, {
        action: AuditAction.SYNTHESIS_JOB_CREATED,
        jobId: id,
        metadata: {
          after: {
            targetType: LocalizationTargetType.PLACE,
            targetId: fields.placeId,
            trigger: SynthesisTrigger.ON_DEMAND,
            langs: [lang satisfies Language],
            includeAudio: true,
          },
        },
      });
      return id;
    });
    return {
      ...this.answer(OnDemandStatus.PENDING),
      jobId,
      retryAfterMs: ON_DEMAND_RETRY_AFTER_MS,
    };
  }

  /** A Place a tourist may ask about: `ACTIVE` and not deleted. */
  private async activePlace(placeId: string): Promise<catalogGrpc.LocalizationSourcePlace> {
    const source = await this.catalog.localizationSource(LocalizationTargetType.PLACE, placeId);
    const place = source.place ?? null;
    if (
      place === null ||
      place.deleted ||
      placeStatusProto.fromProto(place.status) !== PlaceStatus.ACTIVE
    ) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
    }
    return place;
  }

  private answer(status: OnDemandStatus): narrationGrpc.RequestOnDemandResponse {
    return { status: onDemandStatusProto.toProto(status), audio: undefined, retryAfterMs: 0 };
  }
}
