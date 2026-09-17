import { EMAIL_TEMPLATE_DATA } from '@wayfare/contracts';
import type { EmailLinkSlot, EmailTemplate, EmailTemplateData } from '@wayfare/contracts';
import type { BundleLocale } from '../locales';
import { emailLayout } from './layout';
import { emailMessage } from './messages';

/** A rendered email. Never stored and never logged (conventions §11.4). */
export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** The placeholders a message string names. */
export function placeholdersOf(message: string): string[] {
  return [...message.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

function display(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((item) => display(item) ?? '').join(', ');
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Fills placeholders; `undefined` when one names an absent value. */
function fill(message: string, data: Readonly<Record<string, unknown>>): string | undefined {
  let complete = true;
  const text = message.replace(PLACEHOLDER, (_match, name: string) => {
    const value = display(data[name]);
    if (value === undefined) complete = false;
    return value ?? '';
  });
  return complete ? text : undefined;
}

function required(message: string, data: Readonly<Record<string, unknown>>, where: string): string {
  const text = fill(message, data);
  if (text === undefined) throw new Error(`${where} names a value the data does not carry`);
  return text;
}

/**
 * Renders a template at send time, in the recipient's locale (conventions §11.1). `data` is
 * validated against the template's schema; `links` are the only URLs placed, one per slot the
 * template declares. A body paragraph naming an absent optional value is left out.
 */
export function renderEmail<T extends EmailTemplate>(
  template: T,
  locale: BundleLocale,
  data: EmailTemplateData<T>,
  links: Partial<Record<EmailLinkSlot, string>>,
): RenderedEmail {
  const values = EMAIL_TEMPLATE_DATA[template].parse(data) as Record<string, unknown>;
  const message = emailMessage(template, locale);
  const subject = required(message.subject, values, `${template}.subject`);
  const preheader = required(message.preheader, values, `${template}.preheader`);
  const paragraphs = message.body.flatMap((paragraph) => {
    const text = fill(paragraph, values);
    return text === undefined || text.trim() === '' ? [] : [text];
  });
  const slot = (name: EmailLinkSlot) => {
    const url = links[name];
    const label = message[name];
    if (url === undefined) return undefined;
    if (label === undefined) throw new Error(`${template} has no ${name} label`);
    return { label: required(label, values, `${template}.${name}`), url };
  };
  const action = slot('action');
  const cancel = slot('cancel');
  const text = [
    ...paragraphs,
    ...(action === undefined ? [] : [`${action.label}: ${action.url}`]),
    ...(cancel === undefined ? [] : [`${cancel.label}: ${cancel.url}`]),
  ].join('\n\n');
  const html = emailLayout({
    lang: locale,
    subject,
    preheader,
    paragraphs,
    ...(action === undefined ? {} : { action }),
    ...(cancel === undefined ? {} : { cancel }),
  });
  return { subject, text: `${text}\n`, html };
}
