import { Injectable } from '@nestjs/common';
import { CATALOG_SUBMISSION_REVIEWED, EmailTemplate, NotificationType } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { EmailDispatcher } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `catalog.submission.reviewed` → the owner's `SUBMISSION_APPROVED` / `SUBMISSION_REJECTED` bell
 * and `SUBMISSION_OUTCOME` email, linking to their submissions (api-endpoints-plan §10). Keyed on
 * the event; an erased owner gets neither. Durable `identity-catalog-submission-reviewed`.
 */
@Injectable()
export class SubmissionReviewedConsumer extends JetStreamConsumer<
  typeof CATALOG_SUBMISSION_REVIEWED
> {
  readonly event = CATALOG_SUBMISSION_REVIEWED;
  readonly service: string = SERVICE_NAME;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly dispatcher: EmailDispatcher,
  ) {
    super();
  }

  async handle(payload: EventPayload<typeof CATALOG_SUBMISSION_REVIEWED>): Promise<void> {
    const data = {
      submissionId: payload.submissionId,
      ...(payload.placeId === undefined ? {} : { placeId: payload.placeId }),
      ...(payload.decisionNote === undefined ? {} : { decisionNote: payload.decisionNote }),
    };
    const type =
      payload.decision === 'APPROVED'
        ? NotificationType.SUBMISSION_APPROVED
        : NotificationType.SUBMISSION_REJECTED;
    const outcome = await this.prisma.$transaction(async (tx) => {
      const delivered = await this.notifications.deliver(tx, {
        recipientUserId: payload.ownerUserId,
        eventId: payload.eventId,
        notification: { type, data },
      });
      if (!delivered.inserted && delivered.skipped !== undefined) return { delivered, mail: null };
      const mail = await this.email.prepare(tx, {
        template: EmailTemplate.SUBMISSION_OUTCOME,
        eventId: payload.eventId,
        recipient: { userId: payload.ownerUserId },
        data: { ...data, decision: payload.decision },
        links: { action: { path: 'ownerSubmissions' } },
        linkApp: 'console',
      });
      return { delivered, mail };
    });
    if (outcome.delivered.inserted) await this.notifications.announce(outcome.delivered.row);
    this.dispatcher.run([outcome.mail]);
  }
}
