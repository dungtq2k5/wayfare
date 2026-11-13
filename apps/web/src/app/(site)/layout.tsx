import type { ReactNode } from 'react';
import { serverTranslator } from '../../i18n/server';
import { SiteFooter } from '../../shell/footer';

/** Every page but the map's: the content, then the footer at the window's bottom when short. */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const { t } = await serverTranslator();
  return (
    <>
      <main id="content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        {children}
      </main>
      <SiteFooter t={t} />
    </>
  );
}
