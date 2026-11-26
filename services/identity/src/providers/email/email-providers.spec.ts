import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_SEND_TIMEOUT_MS, EmailSendError } from './email-provider';
import type { OutgoingEmail } from './email-provider';
import { NodemailerEmailProvider } from './nodemailer.email-provider';
import {
  readResendDomainTracking,
  ResendEmailProvider,
  verifyResendWebhook,
} from './resend.email-provider';

const resend = vi.hoisted(() => ({
  send: vi.fn(),
  verify: vi.fn(),
  getDomain: vi.fn(),
}));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resend.send };
    webhooks = { verify: resend.verify };
    domains = { get: resend.getDomain };
  },
}));
const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }));
vi.mock('nodemailer', () => ({ createTransport: vi.fn(() => smtp) }));

const message: OutgoingEmail = {
  from: 'Wayfare <no-reply@wayfare.test>',
  to: 'a@example.test',
  subject: 'Hi',
  text: 'Hi',
  html: '<p>Hi</p>',
  tags: { template: 'verify' },
  idempotencyKey: 'k1',
};

async function failure(promise: Promise<unknown>): Promise<EmailSendError> {
  const error = await promise.then(
    () => {
      throw new Error('expected the send to fail');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EmailSendError);
  return error as EmailSendError;
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Resend', () => {
  it('sends with the idempotency key and the tags as name/value pairs', async () => {
    resend.send.mockResolvedValueOnce({ data: { id: 'm1' }, error: null });
    expect(await new ResendEmailProvider('re_x').send(message)).toEqual({
      providerMessageId: 'm1',
    });
    expect(resend.send).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [{ name: 'template', value: 'verify' }] }),
      { idempotencyKey: 'k1' },
    );
  });

  it('retries a network failure, a timeout, a 429, a 5xx or no status; never a 4xx', async () => {
    const provider = new ResendEmailProvider('re_x');
    resend.send.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await failure(provider.send(message))).toMatchObject({
      kind: 'network',
      transient: true,
    });
    for (const [statusCode, transient] of [
      [429, true],
      [503, true],
      [null, true],
      [422, false],
    ] as const) {
      resend.send.mockResolvedValueOnce({ data: null, error: { name: 'refused', statusCode } });
      expect(await failure(provider.send(message))).toMatchObject({ kind: 'refused', transient });
    }
    vi.useFakeTimers();
    resend.send.mockReturnValueOnce(new Promise(() => {}));
    const late = failure(provider.send(message));
    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
    expect(await late).toMatchObject({ kind: 'timeout', transient: true });
  });

  it('verifies a webhook with Resend’s own helper and returns its event', () => {
    resend.verify.mockReturnValueOnce({ type: 'email.bounced' });
    const headers = { id: 'msg_1', timestamp: '1', signature: 'v1,x' };
    expect(verifyResendWebhook('{}', headers, 'whsec_x')).toEqual({ type: 'email.bounced' });
    expect(resend.verify).toHaveBeenCalledWith({
      payload: '{}',
      headers,
      webhookSecret: 'whsec_x',
    });
  });

  it('reads a domain’s tracking as on only when Resend says true, and refuses an error', async () => {
    resend.getDomain.mockResolvedValueOnce({
      data: { open_tracking: true, click_tracking: null },
      error: null,
    });
    expect(await readResendDomainTracking('re_admin', 'd1')).toEqual({
      openTracking: true,
      clickTracking: false,
    });
    resend.getDomain.mockResolvedValueOnce({ data: null, error: { name: 'not_found' } });
    expect(await failure(readResendDomainTracking('re_admin', 'd1'))).toMatchObject({
      kind: 'not_found',
      transient: false,
    });
  });
});

describe('SMTP through Nodemailer (local only)', () => {
  it('sends the tags as X-Wayfare headers, and closes the transport on shutdown', async () => {
    smtp.sendMail.mockResolvedValueOnce({ messageId: '<m1@local>' });
    const provider = new NodemailerEmailProvider('smtp://localhost:1025');
    expect(await provider.send(message)).toEqual({ providerMessageId: '<m1@local>' });
    expect(smtp.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'X-Wayfare-template': 'verify' } }),
    );
    provider.onApplicationShutdown();
    expect(smtp.close).toHaveBeenCalled();
  });

  it('calls a 5xx reply permanent, and anything else worth a retry', async () => {
    const provider = new NodemailerEmailProvider('smtp://localhost:1025');
    smtp.sendMail.mockRejectedValueOnce(Object.assign(new Error('mailbox'), { responseCode: 550 }));
    expect(await failure(provider.send(message))).toMatchObject({ kind: 'smtp', transient: false });
    smtp.sendMail.mockRejectedValueOnce(Object.assign(new Error('busy'), { responseCode: 421 }));
    expect((await failure(provider.send(message))).transient).toBe(true);
    smtp.sendMail.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await failure(provider.send(message))).transient).toBe(true);
    vi.useFakeTimers();
    smtp.sendMail.mockReturnValueOnce(new Promise(() => {}));
    const late = failure(provider.send(message));
    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
    expect(await late).toMatchObject({ kind: 'timeout', transient: true });
  });
});
