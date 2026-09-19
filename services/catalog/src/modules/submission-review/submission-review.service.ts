import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  CATALOG_SUBMISSION_REVIEWED,
  effectiveLimit,
  SubmissionKind,
  SubmissionStatus,
  zApproveSubmissionInput,
  zRejectSubmissionInput,
  zSubmissionQueueQuery,
  zUuidV7,
} from '@wayfare/contracts';
import type { Entitlements } from '@wayfare/contracts';
import { submissionKindProto, submissionStatusProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import {
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client';
import { BillingPortService } from '../billing-port/billing-port.service';
import { IdentityPortService } from '../identity-port/identity-port.service';
import { submissionAuditRecord } from '../places/domain/place-audit';
import {
  changedFields,
  snapshotOfPayload,
  snapshotOfPlace,
  submissionDiff,
} from '../places/domain/submission-diff';
import type { EditableSnapshot } from '../places/domain/submission-diff';
import { PlacesService } from '../places/places.service';
import type { FixedPlace, SubmissionApproval } from '../places/places.service';
import { PrismaService } from '../prisma/prisma.service';
import { hasPlaceRoom, payloadLimitBreach } from '../submissions/domain/submission-rules';
import { SUBMISSION_SELECT, toSubmission } from '../submissions/submission.mapper';
import { readPayload } from '../submissions/submissions.service';
import type { CatalogTx } from '../sync/sync.service';
import { REVIEW_SELECT, toSubmissionAdmin } from './submission-review.mapper';

const submissionIdField = z.object({ submissionId: zUuidV7 });

/** A stored base, as `EditableSnapshot` wrote it. */
const baseOf = (value: unknown): EditableSnapshot | null =>
  value === null || value === undefined ? null : (value as EditableSnapshot);

/**
 * The submission review queue (api-endpoints-plan §3.4, rdm-spec C-11). An approval reads billing
 * and identity first — a remote call cannot sit inside the transaction — then applies the payload
 * in one transaction through the ordinary write steps, with the reviewer's editorial values.
 */
@Injectable()
export class SubmissionReviewService {
  private readonly logger = new Logger(SubmissionReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly places: PlacesService,
    private readonly billing: BillingPortService,
    private readonly identity: IdentityPortService,
  ) {}

  /** `GET /admin/submissions`: oldest first, page style. */
  async listSubmissions(
    request: catalogGrpc.ListSubmissionsRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.ListSubmissionsResponse> {
    requireAccountContext(context);
    const status =
      request.status === undefined ? undefined : submissionStatusProto.fromProto(request.status);
    const kind =
      request.kind === undefined ? undefined : submissionKindProto.fromProto(request.kind);
    const query = parseRpcRequest(zSubmissionQueueQuery, {
      page: request.page?.page || undefined,
      pageSize: request.page?.pageSize || undefined,
      status: status ?? undefined,
      kind: kind ?? undefined,
      areaId: request.areaId,
    });
    const conditions: Prisma.Sql[] = [Prisma.sql`s.status = ${query.status}`];
    if (query.kind !== undefined) conditions.push(Prisma.sql`s.kind = ${query.kind}`);
    if (query.areaId !== undefined) {
      // A creation's area covers its proposed location; an update's is its Venue's.
      conditions.push(Prisma.sql`(
        (s.kind = ${SubmissionKind.UPDATE} AND p.area_id = ${query.areaId}::uuid)
        OR (s.kind = ${SubmissionKind.CREATE} AND EXISTS (
          SELECT 1 FROM areas a
          WHERE a.id = ${query.areaId}::uuid
            AND ST_Covers(a.boundary, ST_SetSRID(ST_MakePoint(
              (s.payload->'location'->>'lng')::float8,
              (s.payload->'location'->>'lat')::float8), 4326)::geography))))`);
    }
    const where = Prisma.join(conditions, ' AND ');
    const [counted, ids] = await Promise.all([
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total
        FROM place_submissions s LEFT JOIN places p ON p.id = s.place_id
        WHERE ${where}`,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM place_submissions s LEFT JOIN places p ON p.id = s.place_id
        WHERE ${where}
        ORDER BY s.submitted_at ASC, s.id ASC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    ]);
    const rows = await this.prisma.placeSubmission.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      select: SUBMISSION_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      submissions: ids.flatMap(({ id }) => {
        const row = byId.get(id);
        return row === undefined ? [] : [toSubmission(row)];
      }),
      page: { page: query.page, pageSize: query.pageSize, total: counted[0]?.total ?? 0 },
    };
  }

  /**
   * `GET /admin/submissions/:id`: the payload, the live Venue, the diff from the owner's base, the
   * owner's entitlements (`null` when billing cannot answer — the page still loads), and the
   * owner-editable fields someone else changed since.
   */
  async getSubmission(
    request: catalogGrpc.GetSubmissionRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.GetSubmissionResponse> {
    requireAccountContext(context);
    const { submissionId } = parseRpcRequest(submissionIdField, request);
    const row = await this.prisma.placeSubmission.findUnique({
      where: { id: submissionId },
      select: REVIEW_SELECT,
    });
    if (row === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'SUBMISSION' });
    const payload = readPayload(row);
    const base = baseOf(row.baseSnapshot);
    const live =
      row.placeId === null ? null : await this.places.placeView(this.prisma, row.placeId);
    let grants: Entitlements | null = null;
    try {
      grants = await this.billing.getEntitlements(row.ownerUserId);
    } catch {
      this.logger.warn({ submissionId }, 'entitlements unavailable; the review page shows none');
    }
    const conflict =
      row.status === String(SubmissionStatus.PENDING) && base !== null && live !== null
        ? changedFields(base, snapshotOfPlace(live))
        : [];
    return {
      submission: toSubmissionAdmin(row, {
        livePlace: live,
        diff: submissionDiff(base, snapshotOfPayload(payload)),
        entitlements: grants,
        conflict,
      }),
    };
  }

  /**
   * `POST /admin/submissions/:id/approve`. `fixed` is the development seed's committed Venue id and
   * public code for a `CREATE` (ADR 0002), never reachable over gRPC.
   */
  async approveSubmission(
    request: catalogGrpc.ApproveSubmissionRequest,
    context: RequestContext,
    fixed: FixedPlace = {},
  ): Promise<catalogGrpc.ApproveSubmissionResponse> {
    const reviewer = requireAccountContext(context);
    const { submissionId } = parseRpcRequest(submissionIdField, request);
    const fields = parseRpcRequest(zApproveSubmissionInput, {
      triggerRadiusM: request.triggerRadiusM,
      narrationPriority: request.narrationPriority,
      categoryCodeOverride: request.categoryCodeOverride,
      decisionNote: request.decisionNote,
      internalNote: request.internalNote,
      acknowledgeConflict: request.acknowledgeConflict,
    });
    const row = await this.pending(submissionId);
    const payload = readPayload(row);
    // Remote reads first: the plan now, and whether the owner is still an owner.
    const grants = await this.billing.getEntitlements(row.ownerUserId);
    const owner = await this.identity.getOwnerVerification(row.ownerUserId);
    if (!owner.verified || !owner.live) {
      throw rpcError('INVALID_STATE', { status: 'OWNER_NOT_VERIFIED' });
    }
    const breach = payloadLimitBreach(payload, grants);
    if (breach !== null) throw rpcError(breach.code, { limit: breach.limit });
    const now = new Date();
    const approval: SubmissionApproval = {
      reviewer,
      ownerUserId: row.ownerUserId,
      payload,
      categoryCode: fields.categoryCodeOverride ?? payload.categoryCode,
      triggerRadiusM: fields.triggerRadiusM,
      narrationPriority: fields.narrationPriority,
      now,
    };
    const decide = (tx: CatalogTx) =>
      this.decide(tx, submissionId, SubmissionStatus.APPROVED, reviewer, now, {
        decisionNote: fields.decisionNote ?? null,
        internalNote: fields.internalNote ?? null,
        categoryCodeOverride: fields.categoryCodeOverride ?? null,
      });
    const record = async (tx: CatalogTx, placeId: string, conflictAcknowledged: boolean) => {
      await this.audit(tx, reviewer, AuditAction.SUBMISSION_APPROVED, submissionId, now, {
        after: {
          kind: row.kind,
          placeId,
          triggerRadiusM: fields.triggerRadiusM,
          narrationPriority: fields.narrationPriority,
          categoryCode: approval.categoryCode,
          categoryOverridden: fields.categoryCodeOverride !== undefined,
          conflictAcknowledged,
          hasDecisionNote: fields.decisionNote !== undefined,
          hasInternalNote: fields.internalNote !== undefined,
        },
      });
      await this.outbox.add(tx, CATALOG_SUBMISSION_REVIEWED, {
        occurredAt: now.toISOString(),
        submissionId,
        placeId,
        ownerUserId: row.ownerUserId,
        decision: 'APPROVED',
        ...(fields.decisionNote === undefined ? {} : { decisionNote: fields.decisionNote }),
      });
    };

    if (row.kind === String(SubmissionKind.CREATE)) {
      const maxPlaces = effectiveLimit('maxPlaces', grants);
      await this.places.approveCreate(
        approval,
        {
          prepare: async (tx) => {
            await this.places.lockOwner(tx, row.ownerUserId);
            await decide(tx);
            // Approved now, so no longer reserved: the Venue about to exist must fit.
            if (!hasPlaceRoom(await this.places.placeLimitUsage(tx, row.ownerUserId), maxPlaces)) {
              throw rpcError('PLACE_LIMIT_REACHED', { limit: maxPlaces });
            }
          },
          record: async (tx, placeId) => {
            await tx.placeSubmission.update({
              where: { id: submissionId },
              data: { placeId },
              select: { id: true },
            });
            await record(tx, placeId, false);
          },
        },
        fixed,
      );
    } else {
      const base = baseOf(row.baseSnapshot);
      if (base === null || row.placeId === null) {
        throw new Error(`UPDATE submission ${submissionId} without its base`);
      }
      let acknowledged = false;
      const placeId = row.placeId;
      await this.places.approveUpdate(placeId, approval, {
        prepare: decide,
        check: (live) => {
          const changed = changedFields(base, live);
          if (changed.length === 0) return;
          if (!fields.acknowledgeConflict) {
            throw rpcError('SUBMISSION_CONFLICT', { changedFields: changed });
          }
          acknowledged = true;
        },
        record: (tx) => record(tx, placeId, acknowledged),
      });
    }
    return { submission: toSubmission(await this.row(submissionId)) };
  }

  /** `POST /admin/submissions/:id/reject`: the owner is always told why. */
  async rejectSubmission(
    request: catalogGrpc.RejectSubmissionRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.RejectSubmissionResponse> {
    const reviewer = requireAccountContext(context);
    const { submissionId } = parseRpcRequest(submissionIdField, request);
    const fields = parseRpcRequest(zRejectSubmissionInput, {
      decisionNote: request.decisionNote,
      internalNote: request.internalNote,
    });
    const row = await this.pending(submissionId);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.decide(tx, submissionId, SubmissionStatus.REJECTED, reviewer, now, {
        decisionNote: fields.decisionNote,
        internalNote: fields.internalNote ?? null,
        categoryCodeOverride: null,
      });
      await this.audit(tx, reviewer, AuditAction.SUBMISSION_REJECTED, submissionId, now, {
        after: { hasDecisionNote: true, hasInternalNote: fields.internalNote !== undefined },
      });
      await this.outbox.add(tx, CATALOG_SUBMISSION_REVIEWED, {
        occurredAt: now.toISOString(),
        submissionId,
        ...(row.placeId === null ? {} : { placeId: row.placeId }),
        ownerUserId: row.ownerUserId,
        decision: 'REJECTED',
        decisionNote: fields.decisionNote,
      });
    });
    return { submission: toSubmission(await this.row(submissionId)) };
  }

  /** A submission awaiting review; another state is `INVALID_STATE`. */
  private async pending(submissionId: string) {
    const row = await this.row(submissionId);
    if (row.status !== String(SubmissionStatus.PENDING)) {
      throw rpcError('INVALID_STATE', { status: row.status });
    }
    return row;
  }

  private async row(submissionId: string) {
    const row = await this.prisma.placeSubmission.findUnique({
      where: { id: submissionId },
      select: { ...SUBMISSION_SELECT, baseSnapshot: true },
    });
    if (row === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'SUBMISSION' });
    return row;
  }

  /**
   * The decision, conditionally: only a `PENDING` submission moves, so of two concurrent reviews
   * one wins and the other is `INVALID_STATE`.
   */
  private async decide(
    tx: CatalogTx,
    submissionId: string,
    status: SubmissionStatus.APPROVED | SubmissionStatus.REJECTED,
    reviewer: AccountContext,
    now: Date,
    notes: {
      readonly decisionNote: string | null;
      readonly internalNote: string | null;
      readonly categoryCodeOverride: string | null;
    },
  ): Promise<void> {
    const moved = await tx.placeSubmission.updateMany({
      where: { id: submissionId, status: SubmissionStatus.PENDING },
      data: { status, reviewedAt: now, reviewedById: reviewer.userId, ...notes },
    });
    if (moved.count === 0) {
      const current = await tx.placeSubmission.findUniqueOrThrow({
        where: { id: submissionId },
        select: { status: true },
      });
      throw rpcError('INVALID_STATE', { status: current.status });
    }
  }

  private async audit(
    tx: CatalogTx,
    actor: AccountContext,
    action: AuditAction,
    submissionId: string,
    now: Date,
    metadata: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      submissionAuditRecord({
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        submissionId,
        metadata,
        origin: actor.origin,
        now,
      }),
    );
  }
}
