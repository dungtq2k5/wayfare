import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  advanceDeliveryStatus,
  EmailBounceType,
  EmailDeliveryStatus,
  isUuidV7,
  parseEnum,
} from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { rpcError } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import type { Env } from '../../config/env.schema';
import { verifyResendWebhook } from '../../providers/email/resend.email-provider';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What an event means for its delivery row (api-endpoints-plan §1.9). Types not listed —
 * `email.scheduled`, `email.delivery_delayed`, `email.opened`, `email.clicked`, `email.received`
 * and anything new — change nothing.
 */
export const RESEND_EVENT_STATUS: Readonly<Record<string, EmailDeliveryStatus>> = {
  'email.sent': EmailDeliveryStatus.SENT,
  'email.delivered': EmailDeliveryStatus.DELIVERED,
  'email.bounced': EmailDeliveryStatus.BOUNCED,
  'email.complained': EmailDeliveryStatus.COMPLAINED,
  'email.failed': EmailDeliveryStatus.FAILED,
  'email.suppressed': EmailDeliveryStatus.FAILED,
};

/** Resend's bounce kinds: only `Permanent` is a hard bounce. */
export function bounceTypeOf(kind: string | undefined): EmailBounceType {
  return kind === 'Permanent' ? EmailBounceType.HARD : EmailBounceType.SOFT;
}

/**
 * Only what the update needs. The payload also names the recipient and the subject, which are
 * never read, stored or logged.
 */
const eventSchema = z.object({
  type: z.string().max(64),
  data: z
    .object({
      email_id: z.string().max(255).optional(),
      tags: z.record(z.string(), z.string()).optional(),
      bounce: z.object({ type: z.string().max(64) }).optional(),
    })
    .optional(),
});

/** How often an update is retried when a concurrent event moved the row first. */
const MAX_ATTEMPTS = 3;

/**
 * Resend's delivery webhook, applied inline (api-endpoints-plan §1.9): one signature check, one
 * forward-only conditional update per event, idempotent by construction.
 */
@Injectable()
export class EmailWebhooksService {
  private readonly logger = new Logger(EmailWebhooksService.name);
  private readonly secret: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('RESEND_WEBHOOK_SECRET', { infer: true });
  }

  async receiveResendEvent(
    request: identityGrpc.ReceiveResendEventRequest,
  ): Promise<identityGrpc.ReceiveResendEventResponse> {
    const event = this.verify(request);
    const parsed = eventSchema.safeParse(event);
    if (!parsed.success) {
      const type = (event as { type?: unknown } | null)?.type;
      this.logger.warn({ type: typeof type === 'string' ? type : null }, 'Unreadable email event');
      return {};
    }
    const status = RESEND_EVENT_STATUS[parsed.data.type];
    if (status === undefined) return {};
    const deliveryId = parsed.data.data?.tags?.delivery_id;
    const messageId = parsed.data.data?.email_id;
    const bounceType =
      status === EmailDeliveryStatus.BOUNCED ? bounceTypeOf(parsed.data.data?.bounce?.type) : null;
    // The row id travels as a tag; the provider's message id is the fallback.
    const where =
      deliveryId !== undefined && isUuidV7(deliveryId)
        ? { id: deliveryId }
        : messageId !== undefined
          ? { providerMessageId: messageId }
          : null;
    if (where === null) return {};

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const row = await this.prisma.emailDelivery.findFirst({
        where,
        select: { id: true, status: true, recipientUserId: true, toEmailHash: true },
      });
      if (row === null) return {}; // sent before this feature, or by another environment
      const current = parseEnum(EmailDeliveryStatus, row.status);
      const next = advanceDeliveryStatus(current, status);
      if (next === null) return {};
      const applied = await this.prisma.$transaction(async (tx) => {
        const moved = await tx.emailDelivery.updateMany({
          where: { id: row.id, status: current },
          data: {
            status: next,
            statusChangedAt: new Date(),
            ...(bounceType === null ? {} : { bounceType }),
            ...(messageId === undefined ? {} : { providerMessageId: messageId }),
          },
        });
        if (moved.count === 0) return false;
        if (bounceType === EmailBounceType.HARD && row.recipientUserId !== null) {
          await this.stampBounce(tx, row.recipientUserId, row.toEmailHash);
        }
        return true;
      });
      if (applied) return {};
    }
    // Three concurrent moves in a row: the provider retries a 5xx.
    throw rpcError('UPSTREAM_UNAVAILABLE');
  }

  /** The signature or nothing: an unverifiable event is `UNAUTHENTICATED`. */
  private verify(request: identityGrpc.ReceiveResendEventRequest): unknown {
    if (this.secret === undefined) throw rpcError('UNAUTHENTICATED');
    try {
      return verifyResendWebhook(
        Buffer.from(request.rawBody).toString('utf8'),
        {
          id: request.svixId,
          timestamp: request.svixTimestamp,
          signature: request.svixSignature,
        },
        this.secret,
      );
    } catch {
      throw rpcError('UNAUTHENTICATED');
    }
  }

  /** A hard bounce marks the account — only while the bounced address is still its address. */
  private async stampBounce(
    tx: Prisma.TransactionClient,
    userId: string,
    toEmailHash: string | null,
  ): Promise<void> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user === null || toEmailHash !== this.email.addressHash(user.email)) return;
    await tx.user.updateMany({
      where: { id: userId, emailBouncedAt: null },
      data: { emailBouncedAt: new Date() },
    });
  }
}
