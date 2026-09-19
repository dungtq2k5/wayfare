import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  effectiveLimit,
  newId,
  PLACE_SUBMISSION_PAYLOAD_VERSION,
  SubmissionKind,
  SubmissionStatus,
  zOwnerSubmissionsQuery,
  zPlaceSubmissionPayload,
  zSubmissionCreateInput,
  zUuidV7,
} from '@wayfare/contracts';
import type { PlaceSubmissionPayload } from '@wayfare/contracts';
import { submissionKindProto, submissionStatusProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import {
  decodeCursor,
  encodeCursor,
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { BillingPortService } from '../billing-port/billing-port.service';
import { editableHash } from '../places/domain/editable-hash';
import { submissionAuditRecord } from '../places/domain/place-audit';
import { snapshotOfPlace } from '../places/domain/submission-diff';
import type { EditableSnapshot } from '../places/domain/submission-diff';
import { PlacesService } from '../places/places.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CatalogTx } from '../sync/sync.service';
import { hasPlaceRoom, payloadLimitBreach } from './domain/submission-rules';
import { SUBMISSION_SELECT, toSubmission } from './submission.mapper';
import type { SubmissionRow } from './submission.mapper';

const submissionIdField = z.object({ submissionId: zUuidV7 });

/** A stored payload, read by its schema version (rdm-spec §2.5). */
export function readPayload(row: {
  readonly payload: unknown;
  readonly payloadSchemaVersion: number;
}): PlaceSubmissionPayload {
  if (row.payloadSchemaVersion !== PLACE_SUBMISSION_PAYLOAD_VERSION) {
    throw new Error(`No reader for payload version ${row.payloadSchemaVersion}`);
  }
  return zPlaceSubmissionPayload.parse(row.payload);
}

/**
 * An owner's own submissions (api-endpoints-plan §3.3, rdm-spec C-11). Checked once here — the
 * owner, the Place, the category, the area, the uploads and the plan — and again at approval.
 */
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly places: PlacesService,
    private readonly billing: BillingPortService,
  ) {}

  /**
   * `POST /owner/submissions`. A `CREATE` reserves a place slot under the owner's lock; an `UPDATE`
   * must start from the live Venue's editable fields, which it keeps as its base, and supersedes
   * the Venue's pending `UPDATE`. Uploads are not consumed here: only an approval does.
   */
  async createSubmission(
    request: catalogGrpc.CreateSubmissionRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.CreateSubmissionResponse> {
    const owner = requireAccountContext(context);
    const input = parseRpcRequest(zSubmissionCreateInput, {
      kind: submissionKindProto.fromProto(request.kind) ?? undefined,
      placeId: request.placeId,
      baseEditableHash: request.baseEditableHash,
      payload: parsePayloadJson(request.payloadJson),
    });
    const grants = await this.billing.getEntitlements(owner.userId);
    const breach = payloadLimitBreach(input.payload, grants);
    if (breach !== null) throw rpcError(breach.code, { limit: breach.limit });
    const maxPlaces = effectiveLimit('maxPlaces', grants);
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      let base: { snapshot: EditableSnapshot; hash: string } | null = null;
      if (input.kind === SubmissionKind.UPDATE) {
        const placeId = input.placeId!;
        // One owner edit at a time per Venue: the partial unique index is the guarantee.
        await tx.$executeRaw`SELECT id FROM places WHERE id = ${placeId}::uuid FOR UPDATE`;
        const snapshot = snapshotOfPlace(await this.places.ownedVenue(tx, placeId, owner.userId));
        const hash = editableHash(snapshot);
        if (hash !== input.baseEditableHash) {
          throw rpcError('SUBMISSION_CONFLICT', { changedFields: [] });
        }
        base = { snapshot, hash };
      }
      await this.places.checkSubmissionPayload(tx, input.payload, {
        ownerUserId: owner.userId,
        placeId: input.placeId ?? null,
      });
      if (input.kind === SubmissionKind.CREATE) {
        await this.places.lockOwner(tx, owner.userId);
        if (!hasPlaceRoom(await this.places.placeLimitUsage(tx, owner.userId), maxPlaces)) {
          throw rpcError('PLACE_LIMIT_REACHED', { limit: maxPlaces });
        }
      } else {
        await this.supersede(tx, input.placeId!, owner, now);
      }
      const id = newId();
      const created = await tx.placeSubmission.create({
        data: {
          id,
          kind: input.kind,
          placeId: input.placeId ?? null,
          ownerUserId: owner.userId,
          status: SubmissionStatus.PENDING,
          payload: input.payload,
          payloadSchemaVersion: PLACE_SUBMISSION_PAYLOAD_VERSION,
          baseEditableHash: base?.hash ?? null,
          ...(base === null
            ? {}
            : { baseSnapshot: base.snapshot as unknown as Prisma.InputJsonValue }),
          submittedAt: now,
        },
        select: SUBMISSION_SELECT,
      });
      await this.audit(tx, owner, AuditAction.SUBMISSION_CREATED, id, now, {
        after: {
          kind: input.kind,
          ...(input.placeId === undefined ? {} : { placeId: input.placeId }),
        },
      });
      return created;
    });
    return { submission: toSubmission(row) };
  }

  /** `GET /owner/submissions`: newest first, cursor style. */
  async listMySubmissions(
    request: catalogGrpc.ListMySubmissionsRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.ListMySubmissionsResponse> {
    const owner = requireAccountContext(context);
    const status =
      request.status === undefined ? undefined : submissionStatusProto.fromProto(request.status);
    const query = parseRpcRequest(zOwnerSubmissionsQuery, {
      cursor: request.page?.cursor,
      limit: request.page?.limit === 0 ? undefined : request.page?.limit,
      placeId: request.placeId,
      status: status ?? undefined,
    });
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
    if (query.cursor !== undefined && after === null) {
      throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/cursor', code: 'invalid_value' }] });
    }
    const rows = await this.prisma.placeSubmission.findMany({
      where: {
        ownerUserId: owner.userId,
        ...(query.placeId === undefined ? {} : { placeId: query.placeId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(after === null ? {} : { id: { lt: after.id } }),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: SUBMISSION_SELECT,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      submissions: page.map(toSubmission),
      page: {
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeCursor({ id: last.id })
            : undefined,
      },
    };
  }

  /** `GET /owner/submissions/:id`: the owner's own only. */
  async getMySubmission(
    request: catalogGrpc.GetMySubmissionRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.GetMySubmissionResponse> {
    const owner = requireAccountContext(context);
    const { submissionId } = parseRpcRequest(submissionIdField, request);
    return { submission: toSubmission(await this.owned(this.prisma, submissionId, owner.userId)) };
  }

  /** `POST /owner/submissions/:id/withdraw`: `PENDING` → `WITHDRAWN`, releasing a reserved slot. */
  async withdrawSubmission(
    request: catalogGrpc.WithdrawSubmissionRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.WithdrawSubmissionResponse> {
    const owner = requireAccountContext(context);
    const { submissionId } = parseRpcRequest(submissionIdField, request);
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.owned(tx, submissionId, owner.userId);
      const moved = await tx.placeSubmission.updateMany({
        where: { id: submissionId, status: SubmissionStatus.PENDING },
        data: { status: SubmissionStatus.WITHDRAWN },
      });
      if (moved.count === 0) throw rpcError('INVALID_STATE', { status: current.status });
      await this.audit(tx, owner, AuditAction.SUBMISSION_WITHDRAWN, submissionId, now, {
        before: { status: SubmissionStatus.PENDING },
      });
      return tx.placeSubmission.findUniqueOrThrow({
        where: { id: submissionId },
        select: SUBMISSION_SELECT,
      });
    });
    return { submission: toSubmission(row) };
  }

  /** The Venue's pending `UPDATE`, if any, as the owner sees it. */
  async pendingUpdateFor(
    db: CatalogTx,
    placeId: string,
  ): Promise<catalogGrpc.Submission | undefined> {
    const row = await db.placeSubmission.findFirst({
      where: { placeId, kind: SubmissionKind.UPDATE, status: SubmissionStatus.PENDING },
      select: SUBMISSION_SELECT,
    });
    return row === null ? undefined : toSubmission(row);
  }

  /** A submission of this owner; another owner's is not found. */
  private async owned(
    db: CatalogTx,
    submissionId: string,
    ownerUserId: string,
  ): Promise<SubmissionRow> {
    const row = await db.placeSubmission.findUnique({
      where: { id: submissionId },
      select: SUBMISSION_SELECT,
    });
    if (row === null || row.ownerUserId !== ownerUserId) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: 'SUBMISSION' });
    }
    return row;
  }

  /** The Venue's pending `UPDATE` becomes `SUPERSEDED`, so the partial unique index holds. */
  private async supersede(
    tx: CatalogTx,
    placeId: string,
    owner: AccountContext,
    now: Date,
  ): Promise<void> {
    const superseded = await tx.$queryRaw<{ id: string }[]>`
      UPDATE place_submissions
      SET status = ${SubmissionStatus.SUPERSEDED}, updated_at = now()
      WHERE place_id = ${placeId}::uuid AND kind = ${SubmissionKind.UPDATE}
        AND status = ${SubmissionStatus.PENDING}
      RETURNING id`;
    for (const { id } of superseded) {
      await this.audit(tx, owner, AuditAction.SUBMISSION_SUPERSEDED, id, now, {
        before: { status: SubmissionStatus.PENDING },
      });
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

/** The payload travels as JSON (rdm-spec §2.5); unreadable JSON is a 400 at `/payload`. */
export function parsePayloadJson(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/payload', code: 'invalid_type' }] });
  }
}
