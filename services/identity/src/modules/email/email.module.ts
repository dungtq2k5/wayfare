import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IdentityConfig } from '../../config/env.schema';
import { EmailProvider } from '../../providers/email/email-provider';
import { NodemailerEmailProvider } from '../../providers/email/nodemailer.email-provider';
import { ResendEmailProvider } from '../../providers/email/resend.email-provider';
import { EmailService } from './email.service';
import type { PendingEmail } from './email.service';

/** How long shutdown waits for in-flight sends. */
const DRAIN_TIMEOUT_MS = 15_000;

/**
 * Runs prepared mails after their transaction committed, without holding the request
 * (conventions §11.4). Shutdown drains it, so a rolling deploy does not drop a send in flight.
 */
@Injectable()
export class EmailDispatcher implements OnApplicationShutdown {
  private readonly logger = new Logger(EmailDispatcher.name);
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(private readonly email: EmailService) {}

  /** Starts each delivery and returns at once. `deliver` records failures; it never throws. */
  run(pending: readonly (PendingEmail | null)[]): void {
    for (const mail of pending) {
      if (mail === null) continue;
      const delivery: Promise<unknown> = this.email
        .deliver(mail)
        .catch((error: unknown) => {
          this.logger.error(
            { deliveryId: mail.deliveryId, kind: error instanceof Error ? error.name : 'unknown' },
            'Email delivery crashed',
          );
        })
        .finally(() => this.inFlight.delete(delivery));
      this.inFlight.add(delivery);
    }
  }

  /** Resolves once nothing is in flight. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  async onApplicationShutdown(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), DRAIN_TIMEOUT_MS);
    });
    const outcome = await Promise.race([this.idle().then(() => 'idle' as const), timedOut]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      this.logger.error({ abandoned: this.inFlight.size }, 'Shutdown abandoned email sends');
    }
  }
}

/** Transactional email: the provider chosen by `EMAIL_PROVIDER`, the service and the dispatcher. */
@Global()
@Module({
  providers: [
    {
      provide: EmailProvider,
      inject: [ConfigService],
      useFactory: (config: IdentityConfig): EmailProvider => {
        if (config.get('EMAIL_PROVIDER', { infer: true }) === 'resend') {
          const apiKey = config.get('RESEND_API_KEY', { infer: true });
          if (apiKey === undefined) throw new Error('RESEND_API_KEY is required for resend');
          return new ResendEmailProvider(apiKey);
        }
        const smtpUrl = config.get('SMTP_URL', { infer: true });
        if (smtpUrl === undefined) throw new Error('SMTP_URL is required for smtp');
        return new NodemailerEmailProvider(smtpUrl);
      },
    },
    EmailService,
    EmailDispatcher,
  ],
  exports: [EmailService, EmailDispatcher],
})
export class EmailModule {}
