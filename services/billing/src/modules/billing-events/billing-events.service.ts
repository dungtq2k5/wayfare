import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  BillingEventStatus,
  zBillingEventsQuery,
  zUuidV7,
} from '@wayfare/contracts';
import { billingEventStatusProto } from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import {
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { billingAuditRecord } from '../entitlements/domain/billing-audit';
import { PrismaService } from '../prisma/prisma.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { BILLING_EVENT_SELECT, toBillingEvent } from './billing-event.mapper';

const eventIdField = z.object({ billingEventId: zUuidV7 });

/**
 * Stripe's events as billing recorded them (api-endpoints-plan §6.2, rdm-spec B-4). Every route
 * needs `billing.event.read`, since a payload may hold a customer email. A replay runs the same
 * guards again, so a stale event still skips.
 */
@Injectable()
export class BillingEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly webhooks: WebhooksService,
  ) {}

  /** A page of events, newest first, by status, type and account. */
  async listBillingEvents(
    request: billingGrpc.ListBillingEventsRequest,
    context: RequestContext,
  ): Promise<billingGrpc.ListBillingEventsResponse> {
    requireAccountContext(context);
    const query = parseRpcRequest(zBillingEventsQuery, {
      page: request.page?.page,
      pageSize: request.page?.pageSize,
      sort: request.page?.sort === '' ? undefined : request.page?.sort,
      status: billingEventStatusProto.fromProto(request.status) ?? undefined,
      eventType: request.eventType ?? undefined,
      billingAccountId: request.billingAccountId ?? undefined,
    });
    const where: Prisma.BillingEventWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.eventType === undefined ? {} : { eventType: query.eventType }),
      ...(query.billingAccountId === undefined ? {} : { billingAccountId: query.billingAccountId }),
    };
    const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
    const [total, rows] = await Promise.all([
      this.prisma.billingEvent.count({ where }),
      this.prisma.billingEvent.findMany({
        where,
        orderBy: [{ receivedAt: direction }, { id: direction }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: BILLING_EVENT_SELECT,
      }),
    ]);
    return {
      events: rows.map(toBillingEvent),
      page: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  /** `FAILED` → `RECEIVED`, its error kept, queued at attempt 1. Anything else is `INVALID_STATE`. */
  async replayBillingEvent(
    request: billingGrpc.ReplayBillingEventRequest,
    context: RequestContext,
  ): Promise<billingGrpc.ReplayBillingEventResponse> {
    const actor = requireAccountContext(context);
    const { billingEventId } = parseRpcRequest(eventIdField, request);
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.billingEvent.findUnique({
        where: { id: billingEventId },
        select: { status: true, eventType: true },
      });
      if (current === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'BILLING_EVENT' });
      const moved = await tx.billingEvent.updateMany({
        where: { id: billingEventId, status: BillingEventStatus.FAILED },
        data: { status: BillingEventStatus.RECEIVED, processedAt: null },
      });
      if (moved.count === 0) throw rpcError('INVALID_STATE', { status: current.status });
      await this.outbox.add(
        tx,
        AUDIT_RECORD,
        billingAuditRecord({
          actor: { type: AuditActorType.USER, userId: actor.userId },
          action: AuditAction.BILLING_EVENT_REPLAYED,
          resource: { type: AuditResourceType.BILLING_EVENT, id: billingEventId },
          metadata: { after: { eventType: current.eventType } },
          origin: actor.origin,
          now,
        }),
      );
      return tx.billingEvent.findUniqueOrThrow({
        where: { id: billingEventId },
        select: BILLING_EVENT_SELECT,
      });
    });
    await this.webhooks.enqueue({ billingEventId, attempt: 1 });
    return { event: toBillingEvent(row) };
  }
}
