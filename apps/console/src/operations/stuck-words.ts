import { isSupportedLanguage } from '@wayfare/contracts';
import type { Translator } from '../i18n/messages';
import { formatDate, formatTime } from '../i18n/format';
import { languageName } from '../i18n/language-names';

/** A stuck Place's last job, as the route says it (K26). */
export interface LastJob {
  readonly status: string;
  readonly errorSummary: string | null;
  readonly cancelledBy: { readonly id: string; readonly name: string | null } | null;
}

/** The same calendar day, in the reader's own time. */
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** Since when a Place is stuck (X1): "since 14:20 today", "since yesterday, 21:05", "since 2 Oct 2026". */
export function stuckSince(iso: string, now: Date, translator: Translator): string {
  const { t, locale } = translator;
  const at = new Date(iso);
  const time = formatTime(iso, locale);
  if (sameDay(at, now)) return t('stuck.sinceToday', { time });
  if (sameDay(at, new Date(now.getTime() - 86_400_000))) return t('stuck.sinceYesterday', { time });
  return t('stuck.sinceDate', { date: formatDate(iso, locale) });
}

/**
 * Why it won't move (X1, K27): its last job failed — with the redacted error — or was cancelled
 * by someone; else "No recent job", since finished jobs are pruned after 14 days.
 */
export function stuckWhy(
  job: LastJob | null,
  who: (person: { id: string; name: string | null }) => string,
  translator: Translator,
): string {
  const { t, locale } = translator;
  if (job?.status === 'FAILED')
    return job.errorSummary === null
      ? t('stuck.failedPlain')
      : t('stuck.failed', {
          // A task's summary starts with its language's code ("zh-Hans: …"): said as its name.
          reason: job.errorSummary.replace(
            /^([A-Za-z]{2,3}(?:-[A-Za-z]{4})?):/,
            (prefix, code: string) =>
              isSupportedLanguage(code) ? `${languageName(code, locale)}:` : prefix,
          ),
        });
  if (job?.status === 'CANCELLED' && job.cancelledBy !== null)
    return t('stuck.cancelled', { who: who(job.cancelledBy) });
  return t('stuck.noJob');
}
