import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  accountLink,
  EMAIL_SECURITY_TEMPLATES,
  EmailDeliveryStatus,
  maskEmail,
  newId,
  SystemRole,
} from '@wayfare/contracts';
import type {
  AccountLinkPath,
  EmailLinkSlot,
  EmailTemplate,
  EmailTemplateData,
  EmailTemplateLinkSlot,
} from '@wayfare/contracts';
import { renderEmail, resolveLocale } from '@wayfare/i18n';
import type { BundleLocale } from '@wayfare/i18n';
import { keyedHash } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import type { Env } from '../../config/env.schema';
import { EmailProvider, EmailSendError } from '../../providers/email/email-provider';
import { PrismaService } from '../prisma/prisma.service';
import { deliveryAddress } from './domain/recipient-policy';
import type { DeliveryPolicy } from './domain/recipient-policy';

/** A link a mail carries: the page, and the token its fragment holds (conventions §11.4). */
export interface EmailLink {
  readonly path: AccountLinkPath;
  readonly token?: string;
}

/** Who a mail is for. A user recipient may override the address; the locale stays theirs. */
export type EmailRecipient =
  | { readonly userId: string; readonly email?: string }
  | { readonly email: string; readonly locale?: string };

/** One mail to prepare (conventions §11.4). */
export interface EmailInput<T extends EmailTemplate> {
  readonly template: T;
  /** The triggering event; for a token mail, the action token's id (rdm-spec I-13). */
  readonly eventId: string;
  readonly recipient: EmailRecipient;
  readonly data: EmailTemplateData<T>;
  readonly links: { readonly [K in EmailTemplateLinkSlot<T>]: EmailLink };
  /**
   * Which app the links open. Defaults to the recipient's: the console for staff and owners, the
   * web app for everyone else. A console-only page (the owner application) names the console.
   */
  readonly linkApp?: 'console' | 'web';
}

/**
 * A mail whose delivery row is written and whose send is due after the commit. It is the only
 * place a link token lives (rdm-spec I-9): never stored, never logged.
 */
export interface PendingEmail {
  readonly deliveryId: string;
  readonly template: EmailTemplate;
  readonly address: string;
  readonly locale: BundleLocale;
  readonly data: unknown;
  readonly links: Readonly<Partial<Record<EmailLinkSlot, EmailLink>>>;
  readonly linkBase: string;
}

/** A client that can run the delivery-row statements: a transaction or the service itself. */
type EmailDb = Prisma.TransactionClient;

/**
 * Transactional email (conventions §11.4): the delivery row is written in the triggering
 * transaction (`prepare`), and the provider is called after the commit (`deliver`). The row, not
 * the provider, is the one-mail-per-event guarantee.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly from: string;
  private readonly hashKey: Buffer;
  private readonly policy: DeliveryPolicy;
  private readonly consoleUrl: string;
  private readonly webUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: EmailProvider,
    config: ConfigService<Env, true>,
  ) {
    this.from = config.get('EMAIL_FROM', { infer: true });
    this.hashKey = config.get('EMAIL_HASH_KEY', { infer: true });
    this.consoleUrl = config.get('CONSOLE_URL', { infer: true });
    this.webUrl = config.get('WEB_URL', { infer: true });
    const mode = config.get('EMAIL_DELIVERY_MODE', { infer: true });
    const allowlist = config.get('EMAIL_NONPROD_ALLOWLIST', { infer: true });
    const catchall = config.get('EMAIL_NONPROD_CATCHALL', { infer: true });
    if (mode === 'open') this.policy = { mode };
    else if (allowlist !== undefined && catchall !== undefined)
      this.policy = { mode, allowlist, catchall };
    else throw new Error('Restricted delivery needs an allowlist and a catch-all');
  }

  /** The keyed hash stored for an address (rdm-spec I-13) — also what the delivery check compares. */
  addressHash(normalizedEmail: string): string {
    return keyedHash(this.hashKey, 'email', normalizedEmail);
  }

  /**
   * Writes the delivery row inside the caller's transaction. `null` means nothing to send: the
   * event already has its mail, or a non-security template was skipped for a bounced address.
   */
  async prepare<T extends EmailTemplate>(
    db: EmailDb,
    input: EmailInput<T>,
  ): Promise<PendingEmail | null> {
    const recipient = await this.resolve(db, input.recipient);
    if (recipient.bounced && !EMAIL_SECURITY_TEMPLATES.has(input.template)) return null;

    const id = newId();
    const inserted = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO email_deliveries
        (id, template, recipient_user_id, event_id, to_email_masked, to_email_hash, provider, status)
      VALUES (${id}::uuid, ${input.template}, ${recipient.userId}::uuid, ${input.eventId}::uuid,
              ${maskEmail(recipient.address)}, ${this.addressHash(recipient.address)},
              ${this.provider.name}, ${EmailDeliveryStatus.QUEUED})
      ON CONFLICT DO NOTHING
      RETURNING id`;
    let deliveryId = inserted[0]?.id;
    if (deliveryId === undefined) {
      const existing = await db.emailDelivery.findFirst({
        where: {
          template: input.template,
          eventId: input.eventId,
          recipientUserId: recipient.userId,
        },
        select: { id: true, status: true, providerMessageId: true },
      });
      // A row a crash left unsent is re-sent under its own id as the idempotency key (I-13).
      const resendable =
        existing?.status === String(EmailDeliveryStatus.QUEUED) &&
        existing.providerMessageId === null;
      if (existing === null || !resendable) return null;
      deliveryId = existing.id;
    }
    return {
      deliveryId,
      template: input.template,
      address: recipient.address,
      locale: recipient.locale,
      data: input.data,
      links: input.links,
      linkBase:
        input.linkApp === undefined
          ? recipient.linkBase
          : input.linkApp === 'console'
            ? this.consoleUrl
            : this.webUrl,
    };
  }

  /**
   * Renders and sends a prepared mail, after the commit, and records the outcome. A provider
   * failure is recorded as `FAILED` and never thrown — except, with `retryTransient`, a transient
   * one, which leaves the row `QUEUED` for an event consumer's redelivery.
   */
  async deliver(
    pending: PendingEmail,
    options: { readonly retryTransient?: boolean } = {},
  ): Promise<'SENT' | 'FAILED'> {
    try {
      const to = deliveryAddress(this.policy, pending.address);
      const links: Partial<Record<EmailLinkSlot, string>> = {};
      for (const [slot, link] of Object.entries(pending.links) as [EmailLinkSlot, EmailLink][]) {
        links[slot] = accountLink(pending.linkBase, link.path, link.token);
      }
      const rendered = renderEmail(pending.template, pending.locale, pending.data as never, links);
      // A redirected copy says who it was meant for — masked, and only ever to the team.
      const subject =
        to === pending.address
          ? rendered.subject
          : `[to ${maskEmail(pending.address)}] ${rendered.subject}`;
      const { providerMessageId } = await this.provider.send({
        from: this.from,
        to,
        subject,
        text: rendered.text,
        html: rendered.html,
        idempotencyKey: pending.deliveryId,
        tags: { delivery_id: pending.deliveryId },
      });
      await this.record(pending.deliveryId, EmailDeliveryStatus.SENT, providerMessageId);
      return 'SENT';
    } catch (error) {
      const kind = error instanceof EmailSendError ? error.kind : errorClass(error);
      if (options.retryTransient === true && error instanceof EmailSendError && error.transient) {
        throw error;
      }
      this.logger.warn(
        { template: pending.template, deliveryId: pending.deliveryId, kind },
        'Email send failed',
      );
      await this.record(pending.deliveryId, EmailDeliveryStatus.FAILED, null);
      return 'FAILED';
    }
  }

  /**
   * Prepare and deliver with no caller transaction — the event consumers' form. A transient
   * provider failure is rethrown with the row still `QUEUED`, so the redelivery re-sends it.
   */
  async send<T extends EmailTemplate>(
    input: EmailInput<T>,
  ): Promise<'SENT' | 'FAILED' | 'ALREADY_SENT'> {
    const pending = await this.prepare(this.prisma, input);
    if (pending === null) return 'ALREADY_SENT';
    return this.deliver(pending, { retryTransient: true });
  }

  /** Moves a row out of `QUEUED`; a webhook that got there first keeps its status. */
  private async record(
    deliveryId: string,
    status: EmailDeliveryStatus,
    providerMessageId: string | null,
  ): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE email_deliveries
        SET provider_message_id = COALESCE(${providerMessageId}, provider_message_id),
            status = CASE WHEN status = ${EmailDeliveryStatus.QUEUED} THEN ${status} ELSE status END,
            status_changed_at = CASE WHEN status = ${EmailDeliveryStatus.QUEUED} THEN now()
                                     ELSE status_changed_at END
        WHERE id = ${deliveryId}::uuid`;
    } catch (error) {
      this.logger.error(
        { deliveryId, kind: errorClass(error) },
        'Recording an email outcome failed',
      );
    }
  }

  private async resolve(
    db: EmailDb,
    recipient: EmailRecipient,
  ): Promise<{
    userId: string | null;
    address: string;
    locale: BundleLocale;
    bounced: boolean;
    linkBase: string;
  }> {
    if (!('userId' in recipient)) {
      return {
        userId: null,
        address: recipient.email,
        locale: resolveLocale(recipient.locale),
        bounced: false,
        linkBase: this.webUrl,
      };
    }
    const user = await db.user.findUniqueOrThrow({
      where: { id: recipient.userId },
      select: {
        email: true,
        preferredLocale: true,
        emailBouncedAt: true,
        ownerVerifiedAt: true,
        roles: { select: { role: { select: { code: true } } } },
      },
    });
    const address = recipient.email ?? user.email;
    // Staff and owners live in the console; everyone else in the web app.
    const inConsole =
      user.ownerVerifiedAt !== null ||
      user.roles.some(({ role }) => role.code !== String(SystemRole.USER));
    return {
      userId: recipient.userId,
      address,
      locale: resolveLocale(user.preferredLocale),
      bounced: address === user.email && user.emailBouncedAt !== null,
      linkBase: inConsole ? this.consoleUrl : this.webUrl,
    };
  }
}

/** An error's class name — the only part of a provider failure that is logged. */
function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
