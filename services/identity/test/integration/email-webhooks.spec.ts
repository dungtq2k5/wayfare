import { createHmac, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { EmailTemplate, newId, SystemRole } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailWebhooksService } from '../../src/modules/email-webhooks/email-webhooks.service';
import { testConfig, testPrisma, truncateAll } from '../setup/database';
import { errorOf, staffAccount } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const { email } = identityServices(prisma);
const secret = `whsec_${randomBytes(24).toString('base64')}`;
const webhooks = new EmailWebhooksService(
  prisma,
  email,
  testConfig({ RESEND_WEBHOOK_SECRET: secret }),
);

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

/** A request signed the Standard Webhooks way, as Resend signs it. */
function signed(event: object, options: { timestamp?: number; secret?: string; id?: string } = {}) {
  const body = JSON.stringify(event);
  const id = options.id ?? `msg_${newId()}`;
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const key = Buffer.from((options.secret ?? secret).slice('whsec_'.length), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return {
    rawBody: Buffer.from(body, 'utf8'),
    svixId: id,
    svixTimestamp: timestamp,
    svixSignature: `v1,${signature}`,
  };
}

const event = (type: string, deliveryId: string, extra: object = {}) => ({
  type,
  created_at: new Date().toISOString(),
  data: {
    email_id: `re_${deliveryId}`,
    to: ['victim.address@example.com'],
    subject: 'Reset your Wayfare password',
    tags: { delivery_id: deliveryId },
    ...extra,
  },
});

/** A sent reset mail for a fresh account. */
async function sentDelivery() {
  const user = await staffAccount(prisma, [SystemRole.USER]);
  const pending = await email.prepare(prisma, {
    template: EmailTemplate.PASSWORD_RESET,
    eventId: newId(),
    recipient: { userId: user.id },
    data: {},
    links: { action: { path: 'resetPassword', token: 'tok' } },
  });
  await email.deliver(pending!);
  return { userId: user.id, deliveryId: pending!.deliveryId };
}

const statusOf = async (id: string) =>
  (await prisma.emailDelivery.findUniqueOrThrow({ where: { id } })).status;

describe('EmailWebhooksService', () => {
  it('moves forward only: SENT → DELIVERED → COMPLAINED, never back', async () => {
    const { deliveryId, userId } = await sentDelivery();
    await webhooks.receiveResendEvent(signed(event('email.delivered', deliveryId)));
    expect(await statusOf(deliveryId)).toBe('DELIVERED');
    await webhooks.receiveResendEvent(signed(event('email.sent', deliveryId)));
    expect(await statusOf(deliveryId)).toBe('DELIVERED');
    await webhooks.receiveResendEvent(signed(event('email.complained', deliveryId)));
    expect(await statusOf(deliveryId)).toBe('COMPLAINED');
    // A complaint never marks the account.
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailBouncedAt,
    ).toBeNull();
  });

  it('a Permanent bounce is HARD and stamps the account; a late delivered changes nothing', async () => {
    const { deliveryId, userId } = await sentDelivery();
    await webhooks.receiveResendEvent(
      signed(
        event('email.bounced', deliveryId, { bounce: { type: 'Permanent', subType: 'General' } }),
      ),
    );
    const row = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(row).toMatchObject({ status: 'BOUNCED', bounceType: 'HARD' });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailBouncedAt,
    ).not.toBeNull();
    await webhooks.receiveResendEvent(signed(event('email.delivered', deliveryId)));
    expect(await statusOf(deliveryId)).toBe('BOUNCED');
  });

  it('a Transient bounce is SOFT and does not stamp the account', async () => {
    const { deliveryId, userId } = await sentDelivery();
    await webhooks.receiveResendEvent(
      signed(event('email.bounced', deliveryId, { bounce: { type: 'Transient' } })),
    );
    expect(
      await prisma.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } }),
    ).toMatchObject({ bounceType: 'SOFT' });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailBouncedAt,
    ).toBeNull();
  });

  it.each(['email.failed', 'email.suppressed'])('%s → FAILED', async (type) => {
    const { deliveryId } = await sentDelivery();
    await webhooks.receiveResendEvent(signed(event(type, deliveryId)));
    expect(await statusOf(deliveryId)).toBe('FAILED');
  });

  it.each([
    'email.scheduled',
    'email.delivery_delayed',
    'email.opened',
    'email.clicked',
    'email.received',
    'domain.updated',
  ])('%s changes nothing', async (type) => {
    const { deliveryId } = await sentDelivery();
    await webhooks.receiveResendEvent(signed(event(type, deliveryId)));
    expect(await statusOf(deliveryId)).toBe('SENT');
  });

  it('finds a row by the provider message id when the tag is missing, and ignores unknown rows', async () => {
    const { deliveryId } = await sentDelivery();
    const row = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    await webhooks.receiveResendEvent(
      signed({ type: 'email.delivered', data: { email_id: row.providerMessageId } }),
    );
    expect(await statusOf(deliveryId)).toBe('DELIVERED');
    await expect(
      webhooks.receiveResendEvent(signed(event('email.delivered', newId()))),
    ).resolves.toEqual({});
  });

  it('a replayed event changes nothing further', async () => {
    const { deliveryId } = await sentDelivery();
    const once = signed(event('email.delivered', deliveryId));
    await webhooks.receiveResendEvent(once);
    const first = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    await webhooks.receiveResendEvent(once);
    const second = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(second.statusChangedAt).toEqual(first.statusChangedAt);
  });

  it('refuses a bad signature, a tampered body and an old timestamp, writing nothing', async () => {
    const { deliveryId } = await sentDelivery();
    const wrongSecret = `whsec_${randomBytes(24).toString('base64')}`;
    const cases = [
      signed(event('email.delivered', deliveryId), { secret: wrongSecret }),
      { ...signed(event('email.delivered', deliveryId)), rawBody: Buffer.from('{"type":"x"}') },
      signed(event('email.delivered', deliveryId), {
        timestamp: Math.floor(Date.now() / 1000) - 600,
      }),
    ];
    for (const request of cases) {
      expect((await errorOf(webhooks.receiveResendEvent(request))).code).toBe('UNAUTHENTICATED');
    }
    expect(await statusOf(deliveryId)).toBe('SENT');
  });

  it('refuses everything when no secret is configured', async () => {
    const unconfigured = new EmailWebhooksService(prisma, email, testConfig());
    const { deliveryId } = await sentDelivery();
    expect(
      (await errorOf(unconfigured.receiveResendEvent(signed(event('email.delivered', deliveryId)))))
        .code,
    ).toBe('UNAUTHENTICATED');
  });

  it('never logs the recipient or the subject', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
      vi.spyOn(Logger.prototype, level),
    );
    try {
      const { deliveryId } = await sentDelivery();
      await webhooks.receiveResendEvent(signed(event('email.delivered', deliveryId)));
      await webhooks.receiveResendEvent(
        signed({ type: 'email.bounced', data: { to: ['victim.address@example.com'], bounce: 7 } }),
      );
      const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
      expect(logged).not.toContain('victim.address');
      expect(logged).not.toContain('Reset your');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
