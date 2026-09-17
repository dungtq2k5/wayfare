// A provider that records instead of sending, for the integration suites.
import { EmailProvider, EmailSendError } from '../../src/providers/email/email-provider';
import type { OutgoingEmail } from '../../src/providers/email/email-provider';

/** Records every message; `failNext` makes the next sends fail. */
export class RecordingEmailProvider extends EmailProvider {
  readonly name = 'NODEMAILER';
  readonly sent: OutgoingEmail[] = [];
  private failures: EmailSendError[] = [];
  private counter = 0;
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;

  /** Holds every send until `resume()`. */
  pause(): void {
    this.gate = new Promise((resolve) => {
      this.open = resolve;
    });
  }

  resume(): void {
    this.open?.();
    this.gate = null;
    this.open = null;
  }

  failNext(error: EmailSendError = new EmailSendError('smtp', false), times = 1): void {
    for (let i = 0; i < times; i++) this.failures.push(error);
  }

  async send(message: OutgoingEmail): Promise<{ providerMessageId: string }> {
    if (this.gate !== null) await this.gate;
    const failure = this.failures.shift();
    if (failure !== undefined) return Promise.reject(failure);
    this.sent.push(message);
    this.counter += 1;
    return Promise.resolve({
      providerMessageId: `<test-${this.counter}-${message.idempotencyKey}>`,
    });
  }

  /** The mails sent to an address, newest last. */
  to(address: string): OutgoingEmail[] {
    return this.sent.filter((message) => message.to === address);
  }

  /** The token in a mail's link fragment. */
  static tokenOf(message: OutgoingEmail): string {
    const match = /#token=([^\s"<]+)/.exec(message.text);
    if (match === null) throw new Error('The mail carries no token link');
    return decodeURIComponent(match[1]!);
  }

  reset(): void {
    this.sent.length = 0;
    this.failures = [];
    this.resume();
  }
}
