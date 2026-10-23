'use client';

import { usersAccept } from '@wayfare/api-client';
import { LEGAL_DOCUMENT_VERSIONS } from '@wayfare/contracts';
import type { LegalDocument } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { Banner } from '@wayfare/ui/states';
import { Card } from '@wayfare/ui/surfaces';
import { Wordmark } from '@wayfare/ui/wordmark';
import { ServerOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Failure } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { ErrorView } from '../states/states';
import { signOut } from './account-menu';

const TERMS_URL = 'https://wayfare.app/terms';
const PRIVACY_URL = 'https://wayfare.app/privacy';

function Standalone({ children }: { children: ReactNode }) {
  return (
    <main
      id="content"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-12"
    >
      <Wordmark height={32} />
      <div className="w-full max-w-lg">{children}</div>
    </main>
  );
}

/** The API down before the shell could be drawn (C16a): the banner, asked again by itself. */
export function ApiDown() {
  const { t } = useConsole();
  useEffect(() => {
    const timer = setInterval(() => window.location.reload(), 15_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="min-h-dvh">
      <Banner
        tone="error"
        icon={<ServerOff aria-hidden />}
        message={t('banner.apiDown')}
        action={
          <Button
            size="sm"
            variant="outline"
            className="text-foreground"
            onClick={() => window.location.reload()}
          >
            {t('banner.retry')}
          </Button>
        }
      />
      <Standalone>{null}</Standalone>
    </div>
  );
}

/** The shell's own read failed (C13). */
export function StandaloneError({ failure }: { failure: Failure }) {
  return (
    <Standalone>
      <ErrorView failure={failure} />
    </Standalone>
  );
}

/**
 * New terms (K18): round 31's A10 at web scale — a full page, *Accept and continue*, *Sign out
 * instead*.
 */
export function NewTerms({ documents }: { documents: readonly string[] }) {
  const { t } = useConsole();
  const [busy, setBusy] = useState(false);
  return (
    <Standalone>
      <Card className="flex flex-col gap-4">
        <p className="text-sm font-medium text-primary">{t('terms.title')}</p>
        <h1 className="text-2xl font-semibold text-foreground">{t('terms.heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('terms.body')}</p>
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            <a
              href={TERMS_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
            >
              {t('terms.terms')}
            </a>
          </li>
          <li>
            <a
              href={PRIVACY_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
            >
              {t('terms.privacy')}
            </a>
          </li>
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <Button
            busy={busy ? t('action.saving') : undefined}
            onClick={() => {
              setBusy(true);
              void Promise.all(
                documents.map((document) =>
                  usersAccept({
                    document: document as LegalDocument,
                    version: LEGAL_DOCUMENT_VERSIONS[document as LegalDocument],
                  }),
                ),
              ).then(
                () => window.location.reload(),
                () => setBusy(false),
              );
            }}
          >
            {t('terms.accept')}
          </Button>
          <Button variant="outline" onClick={() => void signOut()}>
            {t('terms.signOut')}
          </Button>
        </div>
      </Card>
    </Standalone>
  );
}
