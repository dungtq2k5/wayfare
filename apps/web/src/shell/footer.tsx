import Link from 'next/link';
import type { Translator } from '../i18n/messages';

/** The footer (the handoff's §2): the legal pages, Settings, and the line on narration's order. */
export function SiteFooter({ t }: { t: Translator['t'] }) {
  const link = (href: string, label: string) => (
    <Link
      href={href}
      className="rounded-sm text-sm text-primary underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </Link>
  );
  return (
    <footer className="flex flex-col gap-2 bg-muted px-4 py-6 tablet:px-6">
      <nav aria-label={t('footer.links')} className="flex flex-wrap gap-x-4 gap-y-2">
        {link('/privacy', t('footer.privacy'))}
        {link('/terms', t('footer.terms'))}
        {link('/owner-agreement', t('footer.ownerAgreement'))}
        {link('/settings', t('footer.settings'))}
      </nav>
      <p className="text-xs text-muted-foreground">{t('footer.line')}</p>
    </footer>
  );
}
