import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  clampOccurredAt,
  ConsentState,
  hasCoordinateField,
  HEATMAP_KEY_TTL_SECONDS,
  heatmapKey,
  isCurrentLegalVersion,
  LEGAL_DOCUMENT_VERSIONS,
  LegalDocument,
} from '@wayfare/contracts';
import { rpcError } from '@wayfare/nest-common';
import type { Redis } from 'ioredis';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { readEvent } from './domain/read-event';

/** A consent decision as the gateway forwards it (api-endpoints-plan §7). */
export interface ConsentDecision {
  readonly analyticsDeviceId: string;
  readonly state: ConsentState;
  readonly policyVersion: string;
}

/** A batch as the gateway forwards it: the events as sent, and the install's platform and build. */
export interface IngestBatch {
  readonly analyticsDeviceId: string;
  readonly eventsJson: readonly string[];
  readonly platform: string;
  readonly appVersion: string;
}

/** What a batch came to. */
export interface IngestResult {
  readonly stored: number;
  readonly duplicates: number;
  readonly dropped: number;
}

const POLICY = LegalDocument.PRIVACY_POLICY;

/** The only writer of A-1 and A-2, and of the heatmap's counters (rdm-spec A-1 … A-3). */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Appends a decision. A grant must be on the current privacy policy; a withdrawal never
   * checks the version, is accepted for an id never seen, and deletes the id's raw events in the
   * same transaction (rdm-spec A-1) — the nightly rebuild then drops the id from the days it still
   * covers.
   */
  async recordConsent(decision: ConsentDecision, now: Date = new Date()): Promise<void> {
    if (
      decision.state === ConsentState.GRANTED &&
      !isCurrentLegalVersion(POLICY, decision.policyVersion)
    ) {
      throw rpcError('LEGAL_VERSION_OUTDATED', {
        document: POLICY,
        currentVersion: LEGAL_DOCUMENT_VERSIONS[POLICY],
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await lockDevice(tx, decision.analyticsDeviceId);
      await tx.consent.create({
        data: {
          analyticsDeviceId: decision.analyticsDeviceId,
          state: decision.state,
          policyVersion: decision.policyVersion,
          recordedAt: now,
        },
      });
      if (decision.state === ConsentState.WITHDRAWN) {
        await tx.event.deleteMany({ where: { analyticsDeviceId: decision.analyticsDeviceId } });
      }
    });
  }

  /**
   * Stores a consented batch: refused whole with a coordinate anywhere
   * (`VALIDATION_FAILED`) or without a current grant (`CONSENT_REQUIRED`, read under the id's lock);
   * each event read on its own, a bad one dropped; duplicates by id dropped; the clock clamped.
   * Each event with a cell adds the id to that cell's counter for the event's hour.
   */
  async ingest(batch: IngestBatch, now: Date = new Date()): Promise<IngestResult> {
    if (batch.eventsJson.some((json) => hasCoordinateField(parseOrNull(json)))) {
      throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/events', code: 'coordinates' }] });
    }
    const read = batch.eventsJson.map((json) => readEvent(json));
    const events = read.flatMap((item) => ('event' in item ? [item.event] : []));
    const reasons = read.flatMap((item) => ('dropped' in item ? [item.dropped] : []));
    const rows = events.map((event) => ({
      id: event.id,
      analyticsDeviceId: batch.analyticsDeviceId,
      sessionId: event.sessionId,
      eventType: event.type,
      trigger: event.trigger ?? null,
      placeId: event.placeId ?? null,
      lang: event.lang ?? null,
      audioTier: event.audioTier ?? null,
      listenMs: event.listenMs ?? null,
      props: event.props as Prisma.InputJsonObject,
      platform: batch.platform,
      appVersion: batch.appVersion,
      occurredAt: clampOccurredAt(new Date(event.occurredAt), now),
      receivedAt: now,
    }));
    const stored = await this.prisma.$transaction(async (tx) => {
      await lockDevice(tx, batch.analyticsDeviceId);
      if (!(await currentlyGranted(tx, batch.analyticsDeviceId)))
        throw rpcError('CONSENT_REQUIRED');
      if (rows.length === 0) return 0;
      const { count } = await tx.event.createMany({ data: rows, skipDuplicates: true });
      return count;
    });
    await this.countCells(
      batch.analyticsDeviceId,
      events.flatMap((event, index) =>
        event.cell === undefined ? [] : [{ cell: event.cell, at: rows[index]!.occurredAt }],
      ),
    );
    if (reasons.length > 0) {
      this.logger.warn(
        {
          dropped: reasons.length,
          malformed: reasons.filter((reason) => reason === 'malformed').length,
          deferred: reasons.filter((reason) => reason === 'deferred').length,
          platform: batch.platform,
          appVersion: batch.appVersion,
        },
        'analytics events dropped',
      );
    }
    return { stored, duplicates: rows.length - stored, dropped: reasons.length };
  }

  /**
   * Adds the id to each cell-hour counter, keyed by the event's hour, kept 8 days. A retried
   * event adds the same id again, which a HyperLogLog ignores. Best effort: the events are stored.
   */
  private async countCells(
    analyticsDeviceId: string,
    cells: readonly { cell: string; at: Date }[],
  ): Promise<void> {
    if (cells.length === 0) return;
    const keys = [...new Set(cells.map(({ cell, at }) => heatmapKey(cell, at)))];
    try {
      const pipeline = this.redis.multi();
      for (const key of keys) {
        pipeline.pfadd(key, analyticsDeviceId);
        pipeline.expire(key, HEATMAP_KEY_TTL_SECONDS);
      }
      await pipeline.exec();
    } catch (error) {
      this.logger.error(
        { alert: true, err: error instanceof Error ? error.message : String(error) },
        'heatmap counters unavailable — cells not counted',
      );
    }
  }
}

function parseOrNull(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * The transaction-scoped advisory lock on one analytics id: a decision and an ingest for the
 * same id never interleave, so a batch racing a withdrawal either commits first (and is deleted by
 * it) or reads the withdrawal (and stores nothing).
 */
async function lockDevice(tx: Prisma.TransactionClient, analyticsDeviceId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${analyticsDeviceId}, 0))`;
}

/** Whether an id's newest decision is a grant on the current privacy policy. */
async function currentlyGranted(
  tx: Prisma.TransactionClient,
  analyticsDeviceId: string,
): Promise<boolean> {
  const newest = await tx.consent.findFirst({
    where: { analyticsDeviceId },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    select: { state: true, policyVersion: true },
  });
  return (
    newest?.state === ConsentState.GRANTED && isCurrentLegalVersion(POLICY, newest.policyVersion)
  );
}
