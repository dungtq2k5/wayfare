'use client';

import { LANGUAGE_NAMES } from '@wayfare/contracts';
import { cn } from '@wayfare/ui/cn';
import {
  ChevronRight,
  FileText,
  Languages,
  Moon,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Sun,
  SunMoon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AnalyticsRow } from './analytics/analytics-row';
import { useTheme } from './app/providers';
import { APP_VERSION } from './env';
import { useWeb } from './i18n/provider';
import { HomeScreenSteps } from './prompts/install-prompt';
import { useLanguagePicker } from './shell/language-picker-state';
import type { Theme } from './theme';

/** Chrome's own install prompt on Android (K13): kept until Settings offers it. */
interface InstallEvent extends Event {
  prompt(): Promise<void>;
}

/** A settings row: a link or a button, with its icon and chevron. */
function ListRow({
  icon,
  label,
  value,
  href,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  href?: string;
  onClick?: () => void;
}) {
  const className =
    'flex min-h-14 w-full items-center gap-4 rounded-lg bg-card px-4 py-3 text-left text-base text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring';
  const body = (
    <>
      <span className="text-foreground">{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      {value === undefined ? null : <span className="text-sm text-muted-foreground">{value}</span>}
      <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
    </>
  );
  return href === undefined ? (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

/**
 * Settings (WS1): language; appearance (System, Light, Dark), kept per browser; the three legal
 * pages; *Add Wayfare to your Home Screen* — Chrome's own prompt on Android, the steps on an iPhone;
 * the version and the map's attribution.
 */
export function SettingsView() {
  const { t, locale } = useWeb();
  const { theme, setTheme } = useTheme();
  const picker = useLanguagePicker();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [steps, setSteps] = useState(false);
  useEffect(() => {
    const keep = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', keep);
    return () => window.removeEventListener('beforeinstallprompt', keep);
  }, []);
  const segment = (value: Theme, label: string, Icon: typeof Sun) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={theme === value}
      onClick={() => setTheme(value)}
      className={cn(
        'flex h-11 flex-1 items-center justify-center gap-2 rounded-md text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
        theme === value ? 'bg-card text-foreground shadow-1' : 'text-muted-foreground',
      )}
    >
      <Icon aria-hidden className="size-5" />
      {label}
    </button>
  );
  return (
    <div className="mx-auto flex w-full max-w-170 flex-col gap-3 px-4 py-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('settings.title')}</h1>
      <ListRow
        icon={<Languages aria-hidden className="size-6" />}
        label={t('settings.language')}
        value={LANGUAGE_NAMES[locale]}
        onClick={() => picker.setOpen(true)}
      />
      <h2 id="appearance" className="pt-2 text-sm font-medium text-muted-foreground">
        {t('settings.appearance')}
      </h2>
      <div
        role="radiogroup"
        aria-labelledby="appearance"
        className="flex gap-1 rounded-lg bg-muted p-1"
      >
        {segment('system', t('settings.system'), SunMoon)}
        {segment('light', t('settings.light'), Sun)}
        {segment('dark', t('settings.dark'), Moon)}
      </div>
      <h2 className="pt-2 text-sm font-medium text-muted-foreground">{t('settings.privacy')}</h2>
      <AnalyticsRow />
      <h2 className="pt-2 text-sm font-medium text-muted-foreground">{t('settings.about')}</h2>
      <ListRow
        icon={<ShieldCheck aria-hidden className="size-6" />}
        label={t('legal.privacy')}
        href="/privacy"
      />
      <ListRow
        icon={<FileText aria-hidden className="size-6" />}
        label={t('legal.terms')}
        href="/terms"
      />
      <ListRow
        icon={<ScrollText aria-hidden className="size-6" />}
        label={t('legal.ownerAgreement')}
        href="/owner-agreement"
      />
      <ListRow
        icon={<Smartphone aria-hidden className="size-6" />}
        label={t('settings.homeScreen')}
        onClick={() => (install === null ? setSteps(true) : void install.prompt())}
      />
      <p className="text-xs text-muted-foreground">
        {t('settings.version', { version: APP_VERSION })}
      </p>
      <HomeScreenSteps open={steps} onDone={() => setSteps(false)} />
    </div>
  );
}
