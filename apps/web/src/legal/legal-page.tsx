import { Languages } from 'lucide-react';
import { notFound } from 'next/navigation';
import { formatDate } from '../places/format';
import { languageName } from '../i18n/language-name';
import { requestLanguage, serverTranslator } from '../i18n/server';
import { legalText } from './legal';
import type { LegalPage } from './legal';

const TITLES = {
  privacy: 'legal.privacy',
  terms: 'legal.terms',
  'owner-agreement': 'legal.ownerAgreement',
} as const;

/**
 * A legal page (WG1): an eyebrow, the title, the version and its date, the text at a 680 px
 * measure; in the page's language when translated, else English with one line saying it applies.
 */
export async function LegalPageView({
  page,
  version,
}: {
  page: LegalPage;
  version: string | null;
}) {
  const { lang } = await requestLanguage();
  const { t } = await serverTranslator();
  const text = legalText(page, lang, version);
  if (text === null) notFound();
  const date = formatDate(new Date(`${text.version}T00:00:00Z`), lang, 'UTC');
  return (
    <article className="mx-auto flex w-full max-w-170 flex-col gap-4 px-4 py-6">
      <p className="text-sm text-muted-foreground">{t('legal.eyebrow')}</p>
      <h1 className="text-2xl font-semibold text-foreground">{t(TITLES[page])}</h1>
      <p className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-secondary px-2 py-0.5 text-sm font-medium text-secondary-foreground">
          {t('legal.version', { version: text.version })}
        </span>
        <span className="text-xs text-muted-foreground">{t('legal.since', { date })}</span>
      </p>
      {text.translated ? null : (
        <p className="flex gap-2 rounded-md bg-info px-3 py-2 text-sm text-info-foreground">
          <Languages aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t('legal.untranslated', { language: languageName(lang, lang) })}
        </p>
      )}
      <div lang={text.lang} className="flex flex-col gap-4">
        {text.blocks.map((block, index) =>
          block.kind === 'heading' ? (
            <h2 key={index} className="pt-2 text-lg font-semibold text-foreground">
              {block.text}
            </h2>
          ) : block.kind === 'note' ? (
            <p key={index} className="text-xs text-muted-foreground">
              {block.text}
            </p>
          ) : (
            <p key={index} className="text-base text-foreground">
              {block.text}
            </p>
          ),
        )}
      </div>
    </article>
  );
}
