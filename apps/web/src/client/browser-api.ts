'use client';

import {
  ApiError,
  authRefresh,
  configureApiClient,
  devicesExchange,
  devicesRegister,
} from '@wayfare/api-client';
import { LEGAL_DOCUMENT_VERSIONS, LegalDocument } from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';
import { API_BASE_URL, APP_VERSION } from '../env';
import { LANGUAGE_COOKIE } from '../i18n/language';
import { ACCOUNT_HINT_COOKIE } from '../session/account-hint';
import { createWebSession } from '../session/web-session';
import { clearPageCookie, readPageCookie } from './cookies';
import { database } from './db';

/** A refresh another tab won (api-endpoints-plan §1.2): the winner's cookie is already set. */
function isLostRefreshRace(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.code === 'INVALID_STATE' &&
    (error.details as { status?: unknown } | undefined)?.status === 'ROTATED'
  );
}

/** The browser's session (K2): its device, and its account when signed in. */
export const session = createWebSession({
  signedIn: () => readPageCookie(ACCOUNT_HINT_COOKIE) !== null,
  store: {
    load: async () => (await (await database()).get('device', 'credentials')) ?? null,
    save: async (credentials) => {
      await (await database()).put('device', credentials, 'credentials');
    },
    clear: async () => {
      await (await database()).delete('device', 'credentials');
    },
  },
  api: {
    register: async () =>
      (
        await devicesRegister(
          {
            platform: 'WEB',
            appVersion: APP_VERSION,
            contentLocale: (readPageCookie(LANGUAGE_COOKIE) as Language | null) ?? navigatorLang(),
            // A visit is the privacy policy's acceptance for an install (rdm-spec I-12).
            privacyPolicyVersion: LEGAL_DOCUMENT_VERSIONS[LegalDocument.PRIVACY_POLICY],
          },
          { anonymous: true },
        )
      ).data,
    exchange: async (credentials) => (await devicesExchange(credentials, { anonymous: true })).data,
    refreshAccount: () =>
      authRefresh({}, { anonymous: true }).then(
        () => true,
        (error: unknown) => {
          if (isLostRefreshRace(error)) return true;
          // The session is over: this browser is signed out.
          if (error instanceof ApiError && error.status === 401)
            clearPageCookie(ACCOUNT_HINT_COOKIE);
          return false;
        },
      ),
  },
});

/** The browser's first language tag, for a device registered before any choice. */
function navigatorLang(): string {
  return navigator.language || 'en';
}

// The browser's client, once (K2): the device as a Bearer token, the account's cookies included.
configureApiClient({ baseUrl: API_BASE_URL, client: 'web', credentials: 'include', session });
