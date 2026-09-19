// catalog's review decisions reach the owner (api-endpoints-plan §10): SUBMISSION_APPROVED or
// SUBMISSION_REJECTED on the bell and SUBMISSION_OUTCOME by email, linking to their submissions;
// a redelivery changes nothing, and an erased owner hears nothing.
import {
  CATALOG_SUBMISSION_REVIEWED,
  EmailTemplate,
  newId,
  NotificationType,
} from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SubmissionReviewedConsumer } from '../../src/modules/submission-reviewed/submission-reviewed.consumer';
import { testPrisma, truncateAll } from '../setup/database';
import { freshEmail } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof identityServices>;
let ownerId: string;
let address: string;

beforeEach(async () => {
  await truncateAll(prisma);
  services = identityServices(prisma);
  address = freshEmail();
  const owner = await prisma.user.create({
    data: { email: address, isEmailVerified: true, ownerVerifiedAt: new Date() },
    select: { id: true },
  });
  ownerId = owner.id;
});
afterAll(() => prisma.$disconnect());

const consumer = () =>
  new SubmissionReviewedConsumer(
    prisma,
    services.notifications,
    services.email,
    services.dispatcher,
  );

const reviewed = (decision: 'APPROVED' | 'REJECTED', decisionNote?: string) =>
  CATALOG_SUBMISSION_REVIEWED.schema.parse({
    eventId: newId(),
    occurredAt: new Date().toISOString(),
    submissionId: newId(),
    ...(decision === 'APPROVED' ? { placeId: newId() } : {}),
    ownerUserId: ownerId,
    decision,
    ...(decisionNote === undefined ? {} : { decisionNote }),
  });

describe('catalog.submission.reviewed', () => {
  it('rings SUBMISSION_APPROVED and mails the outcome once, linking to the submissions', async () => {
    const payload = reviewed('APPROVED', 'Welcome');
    await consumer().handle(payload);
    await services.dispatcher.idle();
    await consumer().handle(payload);
    await services.dispatcher.idle();
    const rows = await prisma.notification.findMany({ where: { recipientUserId: ownerId } });
    expect(rows).toEqual([
      expect.objectContaining({
        type: NotificationType.SUBMISSION_APPROVED,
        data: {
          submissionId: payload.submissionId,
          placeId: payload.placeId,
          decisionNote: 'Welcome',
        },
      }),
    ]);
    const mails = services.mailbox.to(address);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain('/owner/submissions');
    expect(mails[0]!.text).not.toContain('#token=');
    const [delivery] = await prisma.emailDelivery.findMany({ where: { recipientUserId: ownerId } });
    expect(delivery!.template).toBe(EmailTemplate.SUBMISSION_OUTCOME);
  });

  it('rings SUBMISSION_REJECTED with the note, and tells an erased owner nothing', async () => {
    await consumer().handle(reviewed('REJECTED', 'Photos are blurry'));
    const [row] = await prisma.notification.findMany({ where: { recipientUserId: ownerId } });
    expect(row).toMatchObject({
      type: NotificationType.SUBMISSION_REJECTED,
      data: expect.objectContaining({ decisionNote: 'Photos are blurry' }),
    });
    await prisma.user.update({
      where: { id: ownerId },
      data: { erasedAt: new Date(), deletedAt: new Date() },
    });
    await consumer().handle(reviewed('REJECTED', 'Again'));
    expect(await prisma.notification.count({ where: { recipientUserId: ownerId } })).toBe(1);
  });
});
