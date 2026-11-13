// The only file importing `nodemailer` (conventions §11.5). Local development: Mailpit.
import { createTransport } from 'nodemailer';
import {
  EMAIL_SEND_TIMEOUT_MS,
  EmailProvider,
  EmailSendError,
  withSendTimeout,
} from './email-provider';
import type { OutgoingEmail } from './email-provider';

/** The part of a Nodemailer transport this adapter uses. */
interface SmtpTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    headers: Record<string, string>;
  }): Promise<{ messageId: string }>;
  close(): void;
}

/** SMTP through Nodemailer. The idempotency key is ignored: nothing re-sends a local mail. */
export class NodemailerEmailProvider extends EmailProvider {
  readonly name = 'NODEMAILER';
  private readonly transport: SmtpTransport;

  constructor(smtpUrl: string) {
    super();
    const options = {
      url: smtpUrl,
      connectionTimeout: EMAIL_SEND_TIMEOUT_MS,
      greetingTimeout: EMAIL_SEND_TIMEOUT_MS,
      socketTimeout: EMAIL_SEND_TIMEOUT_MS,
    };
    this.transport = createTransport(options); // NOSONAR: S5332, local Mailpit only; production refuses EMAIL_PROVIDER=smtp
  }

  async send(message: OutgoingEmail): Promise<{ providerMessageId: string }> {
    try {
      const info = await withSendTimeout(
        this.transport.sendMail({
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: Object.fromEntries(
            Object.entries(message.tags).map(([name, value]) => [`X-Wayfare-${name}`, value]),
          ),
        }),
      );
      return { providerMessageId: info.messageId };
    } catch (error) {
      if (error instanceof EmailSendError) throw error;
      const responseCode = (error as { responseCode?: unknown }).responseCode;
      const permanent = typeof responseCode === 'number' && responseCode >= 500;
      throw new EmailSendError('smtp', !permanent);
    }
  }

  /** Nest calls this on shutdown, after the dispatcher drained. */
  onApplicationShutdown(): void {
    this.transport.close();
  }
}
