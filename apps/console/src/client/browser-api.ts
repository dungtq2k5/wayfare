'use client';

import { authRefresh, configureApiClient } from '@wayfare/api-client';
import { API_BASE_URL } from '../env';
import { cookieSession } from '../session/cookie-session';

/** The browser's session: the cookies, refreshed by K4's rule. */
export const session = cookieSession(() => authRefresh({}, { anonymous: true }));

// The browser's client, once (K2): cookies travel to the gateway's origin locally, and to the
// console's own `/api` in a deployed environment.
configureApiClient({ baseUrl: API_BASE_URL, client: 'console', credentials: 'include', session });
