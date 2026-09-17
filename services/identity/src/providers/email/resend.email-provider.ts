// The only file importing `resend` (conventions §11.5).
import { Resend } from 'resend';
import type { WebhookEventPayload } from 'resend';
import { EmailProvider, EmailSendError, withSendTimeout } from './email-provider';
import type { OutgoingEmail } from './email-provider';

/** Resend, with a sending-only API key (conventions §11.4). */
export class ResendEmailProvider extends EmailProvider {
  readonly name = 'RESEND';
  private readonly client: Resend;

  constructor(apiKey: string) {
    super();
    this.client = new Resend(apiKey);
  }

  async send(message: OutgoingEmail): Promise<{ providerMessageId: string }> {
    let response: Awaited<ReturnType<Resend['emails']['send']>>;
    try {
      response = await withSendTimeout(
        this.client.emails.send(
          {
            from: message.from,
            to: message.to,
            subject: message.subject,
            text: message.text,
            html: message.html,
            tags: Object.entries(message.tags).map(([name, value]) => ({ name, value })),
          },
          { idempotencyKey: message.idempotencyKey },
        ),
      );
    } catch (error) {
      if (error instanceof EmailSendError) throw error;
      throw new EmailSendError('network', true);
    }
    if (response.error !== null) {
      const status = response.error.statusCode;
      throw new EmailSendError(
        response.error.name,
        status === null || status === 429 || status >= 500,
      );
    }
    return { providerMessageId: response.data.id };
  }
}

/** The raw headers Resend signs a webhook with (Standard Webhooks). */
export interface ResendWebhookHeaders {
  readonly id: string;
  readonly timestamp: string;
  readonly signature: string;
}

/**
 * Verifies a webhook body with Resend's own helper (Standard Webhooks, 5-minute tolerance) and
 * returns the event. Throws on a bad signature or an old timestamp. No API call is made, so the
 * client needs no real key.
 */
export function verifyResendWebhook(
  rawBody: string,
  headers: ResendWebhookHeaders,
  webhookSecret: string,
): unknown {
  const verified: WebhookEventPayload = new Resend('re_verify_only').webhooks.verify({
    payload: rawBody,
    headers: { ...headers },
    webhookSecret,
  });
  return verified;
}

/** A sending domain's tracking settings, read with a full-access key (deploy step only). */
export async function readResendDomainTracking(
  adminApiKey: string,
  domainId: string,
): Promise<{ openTracking: boolean; clickTracking: boolean }> {
  const response = await withSendTimeout(new Resend(adminApiKey).domains.get(domainId));
  if (response.error !== null) {
    throw new EmailSendError(response.error.name, false);
  }
  return {
    openTracking: response.data.open_tracking === true,
    clickTracking: response.data.click_tracking === true,
  };
}
