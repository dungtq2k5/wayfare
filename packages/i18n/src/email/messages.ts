import { EMAIL_TEMPLATES } from '@wayfare/contracts';
import type { EmailTemplate } from '@wayfare/contracts';
import { z } from 'zod';
import { BUNDLE_LOCALES, readBundle } from '../locales';
import type { BundleLocale } from '../locales';

/** One template's messages. `action` / `cancel` label its link slots. */
export const emailMessageSchema = z
  .object({
    subject: z.string().min(1),
    preheader: z.string().min(1),
    body: z.array(z.string().min(1)).min(1),
    action: z.string().min(1).optional(),
    cancel: z.string().min(1).optional(),
  })
  .strict();

/** One template's messages. */
export type EmailMessage = z.output<typeof emailMessageSchema>;

/** A locale's email bundle; `en` must be complete, others may leave templates out. */
export type EmailBundle = Partial<Record<EmailTemplate, EmailMessage>>;

const bundleSchema = z.partialRecord(z.enum(EMAIL_TEMPLATES), emailMessageSchema);

/** Every bundle, validated when the module loads — a malformed file stops the service at boot. */
export const EMAIL_BUNDLES: Readonly<Record<BundleLocale, EmailBundle>> = Object.fromEntries(
  BUNDLE_LOCALES.map((locale) => [
    locale,
    bundleSchema.parse(readBundle(locale, 'email')) as EmailBundle,
  ]),
) as Record<BundleLocale, EmailBundle>;

/** A template's messages in a locale, falling back to `en` per key. */
export function emailMessage(template: EmailTemplate, locale: BundleLocale): EmailMessage {
  const fallback = EMAIL_BUNDLES.en[template];
  if (fallback === undefined) throw new Error(`The en bundle has no ${template} messages`);
  return { ...fallback, ...(EMAIL_BUNDLES[locale][template] ?? {}) };
}

/** The templates and keys a locale lacks, as `TEMPLATE.key` — for the completeness test. */
export function missingEmailKeys(locale: BundleLocale): string[] {
  const missing: string[] = [];
  for (const template of EMAIL_TEMPLATES) {
    const base = EMAIL_BUNDLES.en[template] ?? {};
    const own = EMAIL_BUNDLES[locale][template] ?? {};
    for (const key of Object.keys(base)) {
      if (!(key in own)) missing.push(`${template}.${key}`);
    }
  }
  return missing;
}
