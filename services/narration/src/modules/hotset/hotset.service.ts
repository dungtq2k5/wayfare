import { Injectable } from '@nestjs/common';
import {
  HOTSET_MAX_PLACES,
  HOTSET_RADIUS_M,
  HOTSET_REQUIRED_READY,
  LocalizationTargetType,
  MAX_LANGUAGE_CODE_LENGTH,
  normalizeLang,
  PlaceStatus,
  PREFETCH_MAX_PLACES,
  SynthesisTrigger,
  zUuidV7,
} from '@wayfare/contracts';
import { placeStatusProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { parseRpcRequest, requireDeviceContext } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { JobsService } from '../jobs/jobs.service';
import { TasksService } from '../tasks/tasks.service';

/** Any well-formed tag: a language narration does not serve is an empty answer, not an error. */
const langField = z.object({ lang: z.string().min(1).max(MAX_LANGUAGE_CODE_LENGTH) });

const hotsetFields = langField.extend({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const prefetchFields = langField.extend({
  placeIds: z.array(zUuidV7).min(1).max(PREFETCH_MAX_PLACES),
});

/**
 * Warming Places up (api-endpoints-plan §4.1): the language switch's hotset, and the background
 * prefetch ahead of the walker. Both ask catalog which Places matter — the nearby query and its
 * rules live there — and turn the ones with no audio into jobs. A repeat costs nothing: a task
 * whose `(target, lang, hash)` is already active coalesces into it (rdm-spec N-2), so a client
 * that calls twice in a second creates no second synthesis.
 */
@Injectable()
export class HotsetService {
  constructor(
    private readonly catalog: CatalogServiceGrpcClient,
    private readonly jobs: JobsService,
    private readonly tasks: TasksService,
  ) {}

  /**
   * A language switch: the nearest Places within `HOTSET_RADIUS_M`, the ones a tourist can already
   * hear, and jobs for the rest. `requiredReadyCount` travels with the answer so the client never
   * holds the number (api-endpoints-plan §4.1).
   */
  async hotset(
    request: narrationGrpc.HotsetRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.HotsetResponse> {
    const deviceId = requireDeviceContext(context);
    const fields = parseRpcRequest(hotsetFields, request);
    const lang = normalizeLang(fields.lang);
    if (lang === null) return { ready: [], pending: [], requiredReadyCount: HOTSET_REQUIRED_READY };

    const { candidates } = await this.catalog.listNarrationCandidates({
      lat: fields.lat,
      lng: fields.lng,
      radiusM: HOTSET_RADIUS_M,
      limit: HOTSET_MAX_PLACES,
      lang,
    });
    const ready = candidates.filter((candidate) => candidate.audioReady);
    const pending = candidates.filter((candidate) => !candidate.audioReady);
    for (const candidate of pending) {
      await this.warm(candidate.placeId, candidate.contentHash, lang, SynthesisTrigger.HOTSET, {
        deviceId,
      });
    }
    return {
      ready: ready.map((candidate) => candidate.placeId),
      pending: pending.map((candidate) => candidate.placeId),
      requiredReadyCount: HOTSET_REQUIRED_READY,
    };
  }

  /**
   * The Places ahead of the walker, at `PREFETCH` priority so a tourist's own tap always goes
   * first. An id that is already ready, unknown or not live is skipped and counted, so a client
   * can see that its list was stale rather than guess (api-endpoints-plan §4.1).
   */
  async prefetch(
    request: narrationGrpc.PrefetchRequest,
    context: RequestContext,
  ): Promise<narrationGrpc.PrefetchResponse> {
    const deviceId = requireDeviceContext(context);
    const fields = parseRpcRequest(prefetchFields, request);
    const lang = normalizeLang(fields.lang);
    if (lang === null) return { queued: [], skipped: [...fields.placeIds] };

    const queued: string[] = [];
    const skipped: string[] = [];
    for (const placeId of fields.placeIds) {
      const hash = await this.warmable(placeId, lang);
      if (hash === null) {
        skipped.push(placeId);
        continue;
      }
      await this.warm(placeId, hash, lang, SynthesisTrigger.PREFETCH, { deviceId });
      queued.push(placeId);
    }
    return { queued, skipped };
  }

  /** The Place's current hash when it is live and its audio is not ready yet; null otherwise. */
  private async warmable(placeId: string, lang: string): Promise<string | null> {
    const source = await this.catalog.localizationSource(LocalizationTargetType.PLACE, placeId);
    const place = source.place ?? null;
    if (
      place === null ||
      place.deleted ||
      placeStatusProto.fromProto(place.status) !== PlaceStatus.ACTIVE
    ) {
      return null;
    }
    const row = place.localizations.find((state) => state.lang === lang);
    const audioReady =
      row !== undefined &&
      row.sourceContentHash === place.contentHash &&
      row.audioSourceContentHash === place.contentHash &&
      row.audioObjectPath != null;
    return audioReady ? null : place.contentHash;
  }

  /** One warmup job. A second one for the same text coalesces rather than synthesizing again. */
  private async warm(
    placeId: string,
    sourceContentHash: string,
    lang: string,
    trigger: SynthesisTrigger,
    by: { deviceId: string },
  ): Promise<void> {
    await this.tasks.transact(async (tx, fx) => {
      await this.jobs.createJob(tx, fx, {
        targetType: LocalizationTargetType.PLACE,
        targetId: placeId,
        sourceContentHash,
        langs: [lang],
        includeAudio: true,
        trigger,
        requestedByDeviceId: by.deviceId,
      });
    });
  }
}
