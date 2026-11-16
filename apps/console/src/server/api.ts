import 'server-only';
import { ApiError, configureApiClient, usersMe } from '@wayfare/api-client';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { GATEWAY_INTERNAL_URL } from '../env';
import { forwardedHeaders } from './forwarded';

// Once, for every request this server handles (K3): the gateway's address and the client kind,
// and no session — the server never refreshes. What differs per visitor travels per call.
configureApiClient({ baseUrl: `${GATEWAY_INTERNAL_URL}/api/v1`, client: 'console' });

/** The header the proxy sets with the page's path and query, for the `/session` return. */
export const PATH_HEADER = 'x-wayfare-path';

/** This request's own options for a generated call: its cookie and address, never cached. */
export async function callerOptions(): Promise<RequestInit> {
  const incoming = await headers();
  return { headers: { ...forwardedHeaders((name) => incoming.get(name)) }, cache: 'no-store' };
}

/** The page's path and query, as the proxy saw it. */
export async function requestPath(): Promise<string> {
  return (await headers()).get(PATH_HEADER) ?? '/';
}

/**
 * A server-side call with the caller's session (K3). A `401` never renders an error: the visitor
 * goes to `/session`, which refreshes in the browser and comes back.
 */
export async function serverCall<T>(call: (options: RequestInit) => Promise<T>): Promise<T> {
  try {
    return await call(await callerOptions());
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/session?next=${encodeURIComponent(await requestPath())}`);
    }
    throw error;
  }
}

/** The signed-in person (K5), read once per request by whoever needs it. */
export const currentUser = cache(
  async () => (await serverCall((options) => usersMe(options))).data,
);

/** What `currentUser` answers. */
export type Me = Awaited<ReturnType<typeof currentUser>>;
