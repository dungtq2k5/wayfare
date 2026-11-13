import { EmailTemplate, maskEmail, newId, normalizeEmail, SystemRole } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EmailSendError } from '../../src/providers/email/email-provider';
import { testPrisma, truncateAll } from '../setup/database';
import { staffAccount } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const services = identityServices(prisma);
const { email, mailbox, dispatcher } = services;

beforeEach(async () => {
  await truncateAll(prisma);
  mailbox.reset();
});
afterAll(() => prisma.$disconnect());

const paymentFailed = (userId: string, eventId = newId()) => ({
  template: EmailTemplate.PAYMENT_FAILED as const,
  eventId,
  recipient: { userId },
  data: { attemptCount: 1 },
  links: {},
});

const reset = (userId: string, token = 'secret-token') => ({
  template: EmailTemplate.PASSWORD_RESET as const,
  eventId: newId(),
  recipient: { userId },
  data: {},
  links: { action: { path: 'resetPassword' as const, token } },
});

async function tourist(address = `t-${newId()}@example.com`) {
  return staffAccount(prisma, [SystemRole.USER], { email: address });
}

describe('EmailService', () => {
  it('writes a masked, hashed row and sends with the row id as key and tag', async () => {
    const user = await tourist('anne@example.com');
    const pending = await email.prepare(prisma, reset(user.id));
    const row = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: pending!.deliveryId },
    });
    expect(row).toMatchObject({
      template: 'PASSWORD_RESET',
      recipientUserId: user.id,
      status: 'QUEUED',
      provider: 'NODEMAILER',
      toEmailMasked: 'a***e@example.com',
      toEmailHash: email.addressHash(normalizeEmail('Anne@example.com')),
      providerMessageId: null,
    });
    expect(await email.deliver(pending!)).toBe('SENT');
    const [sent] = mailbox.sent;
    expect(sent).toMatchObject({
      to: 'anne@example.com',
      idempotencyKey: row.id,
      tags: { delivery_id: row.id },
      subject: 'Reset your Wayfare password',
    });
    expect(sent!.text).toContain('http://web.localhost/reset-password#token=secret-token');
    const after = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('SENT');
    expect(after.providerMessageId).toContain(row.id);
    // Nothing sensitive in the row: no subject, body or token column exists or holds it.
    expect(JSON.stringify(after)).not.toMatch(/secret-token|Reset your|anne@/);
  });

  it('links a staff member or an owner to the console, and renders their locale', async () => {
    const admin = await staffAccount(prisma, [SystemRole.ADMIN]);
    await prisma.user.update({ where: { id: admin.id }, data: { preferredLocale: 'vi' } });
    const owner = await staffAccount(prisma, [], { ownerVerifiedAt: new Date() });
    for (const id of [admin.id, owner.id]) {
      const pending = await email.prepare(prisma, reset(id));
      await email.deliver(pending!);
    }
    expect(mailbox.sent[0]!.text).toContain('http://console.localhost/reset-password#token=');
    expect(mailbox.sent[0]!.subject).toBe('Đặt lại mật khẩu Wayfare');
    expect(mailbox.sent[1]!.text).toContain('http://console.localhost/');
  });

  it('two concurrent prepares for one event write one row, and neither aborts its transaction', async () => {
    const user = await tourist();
    const eventId = newId();
    const results = await Promise.all(
      ['First', 'Second'].map((name) =>
        prisma.$transaction(async (tx) => {
          const pending = await email.prepare(tx, paymentFailed(user.id, eventId));
          await tx.user.update({ where: { id: user.id }, data: { fullName: name } });
          return pending;
        }),
      ),
    );
    expect(await prisma.emailDelivery.count()).toBe(1);
    // The loser finds a QUEUED row with no provider id, which it may send under the same key.
    expect(results.filter((pending) => pending !== null)).toHaveLength(2);
    expect(new Set(results.map((pending) => pending?.deliveryId)).size).toBe(1);
    const user2 = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(['First', 'Second']).toContain(user2.fullName);
  });

  it('re-sends a QUEUED row under its own id, and never a sent one', async () => {
    const user = await tourist();
    const eventId = newId();
    const first = await email.prepare(prisma, paymentFailed(user.id, eventId));
    // A crash before the send: the redelivery prepares again and gets the same row.
    const again = await email.prepare(prisma, paymentFailed(user.id, eventId));
    expect(again?.deliveryId).toBe(first!.deliveryId);
    expect(await email.send(paymentFailed(user.id, eventId))).toBe('SENT');
    expect(await email.send(paymentFailed(user.id, eventId))).toBe('ALREADY_SENT');
    expect(mailbox.sent).toHaveLength(1);
    expect(mailbox.sent[0]!.idempotencyKey).toBe(first!.deliveryId);
  });

  it('skips a non-security mail to a bounced address, but never a security one', async () => {
    const user = await tourist();
    await prisma.user.update({ where: { id: user.id }, data: { emailBouncedAt: new Date() } });
    expect(await email.prepare(prisma, paymentFailed(user.id))).toBeNull();
    expect(await prisma.emailDelivery.count()).toBe(0);
    expect(await email.prepare(prisma, reset(user.id))).not.toBeNull();
    // An override address is not the bounced one.
    expect(
      await email.prepare(prisma, {
        ...paymentFailed(user.id),
        recipient: { userId: user.id, email: 'other@example.com' },
      }),
    ).not.toBeNull();
  });

  it('a rolled-back transaction leaves no row and delivers nothing', async () => {
    const user = await tourist();
    const failed = prisma.$transaction(async (tx) => {
      const pending = await email.prepare(tx, reset(user.id));
      expect(pending).not.toBeNull();
      throw new Error('business failure');
    });
    await expect(failed).rejects.toThrow('business failure');
    expect(await prisma.emailDelivery.count()).toBe(0);
    expect(mailbox.sent).toHaveLength(0);
  });

  it('restricted delivery redirects outside the allowlist, recording the intended recipient', async () => {
    const user = await tourist('real.owner@owner.vn');
    const pending = await email.prepare(prisma, reset(user.id));
    await email.deliver(pending!);
    const [sent] = mailbox.sent;
    expect(sent!.to).toBe('team@wayfare.local');
    expect(sent!.subject).toBe(
      `[to ${maskEmail('real.owner@owner.vn')}] Reset your Wayfare password`,
    );
    const row = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: pending!.deliveryId },
    });
    expect(row.toEmailMasked).toBe('r***r@owner.vn');
  });

  it('records a failure as FAILED; the consumer form rethrows a transient one and stays QUEUED', async () => {
    const user = await tourist();
    mailbox.failNext(new EmailSendError('invalid_from', false));
    const pending = await email.prepare(prisma, reset(user.id));
    expect(await email.deliver(pending!)).toBe('FAILED');
    expect(
      (await prisma.emailDelivery.findUniqueOrThrow({ where: { id: pending!.deliveryId } })).status,
    ).toBe('FAILED');

    const eventId = newId();
    mailbox.failNext(new EmailSendError('timeout', true));
    await expect(email.send(paymentFailed(user.id, eventId))).rejects.toThrow(EmailSendError);
    const row = await prisma.emailDelivery.findFirstOrThrow({ where: { eventId } });
    expect(row.status).toBe('QUEUED');
    expect(await email.send(paymentFailed(user.id, eventId))).toBe('SENT');
  });

  it('the dispatcher answers at once and drains on shutdown', async () => {
    const user = await tourist();
    const pending = await Promise.all([
      email.prepare(prisma, reset(user.id)),
      email.prepare(prisma, reset(user.id)),
    ]);
    mailbox.pause();
    expect(dispatcher.run([...pending, null])).toBeUndefined();
    // run() returned while both sends are still held by the provider.
    expect(mailbox.sent).toHaveLength(0);
    const drained = dispatcher.onApplicationShutdown();
    mailbox.resume();
    await drained;
    expect(await prisma.emailDelivery.count({ where: { status: 'SENT' } })).toBe(2);
    expect(mailbox.sent).toHaveLength(2);
    await dispatcher.idle();
  });
});
