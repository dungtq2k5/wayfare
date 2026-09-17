import {
  EMAIL_TEMPLATE_DATA,
  EMAIL_TEMPLATE_LINKS,
  EMAIL_TEMPLATES,
  EmailTemplate,
} from '@wayfare/contracts';
import type { EmailLinkSlot } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { BUNDLE_LOCALES } from '../locales';
import { resolveLocale } from '../resolve-locale';
import { EMAIL_BUNDLES, missingEmailKeys } from './messages';
import { placeholdersOf, renderEmail } from './render';

const ID = '01990000-0000-7000-8000-000000000001';

/** Valid data for every template, with every optional value set. */
const SAMPLE_DATA: Record<EmailTemplate, Record<string, unknown>> = {
  EMAIL_VERIFICATION: {},
  PASSWORD_RESET: {},
  ACCOUNT_SETUP: { inviterRoleNames: ['Admin'] },
  EMAIL_CHANGE: {},
  EMAIL_CHANGED_NOTICE: { newEmailMasked: 'n***w@example.com', requestIp: '203.0.113.9' },
  STAFF_INVITE: { membershipId: ID, sellerName: 'Cafe', expiresAt: '2026-09-23T00:00:00.000Z' },
  OWNER_REGISTRATION_OUTCOME: { registrationId: ID, decision: 'APPROVED', decisionNote: 'Ok' },
  SUBMISSION_OUTCOME: { submissionId: ID, decision: 'REJECTED', decisionNote: 'Blurry' },
  PAYMENT_FAILED: { attemptCount: 2, nextAttemptAt: '2026-09-23T00:00:00.000Z' },
  ENTITLEMENTS_REDUCED: { entitlementsVersion: 2, reduced: [] },
  ACCOUNT_RECOVERY_NOTICE: { recoveryId: ID, stage: 'LINK_SENT' },
  VOUCHER_MOVED: { voucherId: ID, offerTitle: 'Bánh mì' },
  VOUCHER_REFUNDED: { orderId: ID, voucherCount: 2, reason: 'VENUE_UNAVAILABLE' },
};

const linksFor = (template: EmailTemplate) =>
  Object.fromEntries(
    (EMAIL_TEMPLATE_LINKS[template] as readonly EmailLinkSlot[]).map((slot) => [
      slot,
      `https://console.example.com/${slot}#token=abc`,
    ]),
  );

/** The data keys a template's schema declares. */
const keysOf = (template: EmailTemplate): string[] =>
  Object.keys((EMAIL_TEMPLATE_DATA[template] as unknown as { shape: object }).shape);

const renderable = EMAIL_TEMPLATES.filter(
  (template) => EMAIL_TEMPLATE_DATA[template].safeParse(SAMPLE_DATA[template]).success,
);

describe('email bundles', () => {
  it('en is complete and vi lacks nothing', () => {
    for (const template of EMAIL_TEMPLATES) expect(EMAIL_BUNDLES.en[template]).toBeDefined();
    expect(missingEmailKeys('vi')).toEqual([]);
  });

  it('every placeholder names a data key, and none names a token', () => {
    for (const locale of BUNDLE_LOCALES) {
      for (const template of EMAIL_TEMPLATES) {
        const message = EMAIL_BUNDLES[locale][template]!;
        const strings = [message.subject, message.preheader, ...message.body];
        for (const name of strings.flatMap(placeholdersOf)) {
          expect(name, `${locale} ${template}`).not.toMatch(/^token$|Token$/);
          expect(keysOf(template), `${locale} ${template} {{${name}}}`).toContain(name);
        }
      }
    }
  });

  it('labels exactly the link slots each template declares', () => {
    for (const locale of BUNDLE_LOCALES) {
      for (const template of EMAIL_TEMPLATES) {
        const message = EMAIL_BUNDLES[locale][template]!;
        const slots: readonly string[] = EMAIL_TEMPLATE_LINKS[template];
        expect(message.action !== undefined, `${locale} ${template} action`).toBe(
          slots.includes('action'),
        );
        expect(message.cancel !== undefined, `${locale} ${template} cancel`).toBe(
          slots.includes('cancel'),
        );
      }
    }
  });
});

describe('renderEmail', () => {
  it.each(BUNDLE_LOCALES.flatMap((locale) => renderable.map((t) => [locale, t] as const)))(
    '%s %s renders with no image and no URL but its links',
    (locale, template) => {
      const links = linksFor(template);
      const email = renderEmail(template, locale, SAMPLE_DATA[template] as never, links);
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.html).not.toContain('<img');
      const urls = email.html.match(/https?:\/\/[^"<\s]+/g) ?? [];
      for (const url of urls) expect(Object.values(links)).toContain(url.replaceAll('&amp;', '&'));
      for (const url of Object.values(links)) expect(email.text).toContain(url);
    },
  );

  it('renders every template', () => {
    expect(renderable).toHaveLength(EMAIL_TEMPLATES.length);
  });

  it('escapes interpolated values in the HTML', () => {
    const email = renderEmail(
      EmailTemplate.VOUCHER_MOVED,
      'en',
      { voucherId: ID, offerTitle: '<script>alert(1)</script> & "x"' },
      { action: 'https://web.example.com/v?a=1&b=2' },
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
    expect(email.html).toContain('href="https://web.example.com/v?a=1&amp;b=2"');
  });

  it('drops a paragraph whose optional value is absent', () => {
    const email = renderEmail(
      EmailTemplate.EMAIL_CHANGED_NOTICE,
      'en',
      { newEmailMasked: 'n***w@example.com' },
      { action: 'https://x.example.com' },
    );
    expect(email.text).not.toContain('The request came from');
    expect(email.text).toContain('n***w@example.com');
  });

  it('renders Vietnamese, and refuses data outside the schema', () => {
    expect(
      renderEmail(EmailTemplate.PASSWORD_RESET, 'vi', {}, { action: 'https://x' }).subject,
    ).toBe('Đặt lại mật khẩu Wayfare');
    expect(() =>
      renderEmail(EmailTemplate.PASSWORD_RESET, 'en', { token: 'x' } as never, {}),
    ).toThrow();
  });
});

describe('resolveLocale', () => {
  it.each([
    ['vi', 'vi'],
    ['vi-VN', 'vi'],
    ['en', 'en'],
    ['ja', 'en'],
    [null, 'en'],
  ])('%s → %s', (preferred, locale) => {
    expect(resolveLocale(preferred)).toBe(locale);
  });
});
