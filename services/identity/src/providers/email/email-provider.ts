import type { EmailProvider as EmailProviderName } from '@wayfare/contracts';

/** How long one provider call may take (conventions §11.5). */
export const EMAIL_SEND_TIMEOUT_MS = 10_000;

/** One message as a provider sends it. Rendered at send time, never stored or logged. */
export interface OutgoingEmail {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** The delivery row id: Resend's idempotency key. */
  readonly idempotencyKey: string;
  /** Message tags; `delivery_id` maps a webhook event back to its row. */
  readonly tags: Readonly<Record<string, string>>;
}

/**
 * A provider's refusal or failure. `transient` (a timeout, a network error, a 429, a 5xx) is what
 * an event consumer may retry through its redelivery. `kind` is a short class name, safe to log —
 * never the provider's response body.
 */
export class EmailSendError extends Error {
  constructor(
    readonly kind: string,
    readonly transient: boolean,
  ) {
    super(`Email send failed: ${kind}`);
    this.name = 'EmailSendError';
  }
}

/**
 * Transactional email, behind one interface (conventions §11.5). An abstract class, so it is its
 * own injection token. No circuit breaker: every send is user-initiated and never retried in a
 * loop (conventions §11.5's stated exception).
 */
export abstract class EmailProvider {
  /** Recorded in `email_deliveries.provider` (rdm-spec I-13). */
  abstract readonly name: `${EmailProviderName}`;

  /** Sends once. Returns the provider's message id; throws `EmailSendError`. */
  abstract send(message: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

/** Rejects with a transient `EmailSendError` when `promise` outlives `ms`. */
export function withSendTimeout<T>(promise: Promise<T>, ms = EMAIL_SEND_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new EmailSendError('timeout', true)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
