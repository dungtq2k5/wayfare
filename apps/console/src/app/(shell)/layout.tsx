import { ApiError, usersAcceptances } from '@wayfare/api-client';
import type { ReactNode } from 'react';
import { failureOf, isUnreachable } from '../../client/errors';
import { accountLocale } from '../../i18n/language';
import { I18nProvider } from '../../i18n/provider';
import { currentUser, serverCall } from '../../server/api';
import type { Me } from '../../server/api';
import { MeProvider } from '../../shell/me';
import type { ShellMe } from '../../shell/me';
import { Shell } from '../../shell/shell';
import { ApiDown, NewTerms, StandaloneError } from '../../shell/standalone';

/** What the shell's client side needs of `/users/me`. */
function shellMe(me: Me): ShellMe {
  return {
    user: {
      id: me.user.id,
      email: me.user.email,
      fullName: me.user.fullName,
      preferredLocale: me.user.preferredLocale,
      isEmailVerified: me.user.isEmailVerified,
      emailBounced: me.user.emailBounced,
    },
    permissions: me.permissions,
    ownership: me.owner === null ? null : me.ownerVerified ? 'verified' : 'applicant',
    signIn: me.signIn,
  };
}

/**
 * Every signed-in page (K5): `/users/me` read on the server with the caller's cookies (K3), the
 * account's language (K12), the navigation its permissions allow — or, instead of the shell, the
 * API-down page (C16a) or the new terms (K18).
 */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  let me: Me;
  try {
    me = await currentUser();
  } catch (error) {
    if (isUnreachable(error)) return <ApiDown />;
    if (error instanceof ApiError) return <StandaloneError failure={failureOf(error)} />;
    throw error;
  }
  const locale = accountLocale(me.user.preferredLocale);
  const acceptances = await serverCall((options) => usersAcceptances(options)).catch(() => null);
  const outdated =
    acceptances?.data
      .filter((acceptance) => !acceptance.current)
      .map((acceptance) => acceptance.document) ?? [];
  return (
    <I18nProvider locale={locale}>
      <MeProvider me={shellMe(me)}>
        {outdated.length > 0 ? <NewTerms documents={outdated} /> : <Shell>{children}</Shell>}
      </MeProvider>
    </I18nProvider>
  );
}
