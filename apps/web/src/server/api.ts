import 'server-only';
import { configureApiClient } from '@wayfare/api-client';
import { headers } from 'next/headers';
import { GATEWAY_INTERNAL_URL } from '../env';
import { forwardedHeaders } from './forwarded';

// Once, for every request this server handles (K3): the gateway's address and the client kind,
// and no session — the server has no device, which lives in the visitor's IndexedDB.
configureApiClient({ baseUrl: `${GATEWAY_INTERNAL_URL}/api/v1`, client: 'web' });

/**
 * This request's own options for a generated call: the visitor's address, so the gateway limits a
 * link's reads by it, and never a cookie — what the server renders is the same for everyone.
 */
export async function visitorOptions(): Promise<RequestInit> {
  const incoming = await headers();
  const { 'x-forwarded-for': forwardedFor } = forwardedHeaders((name) => incoming.get(name));
  return {
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
    cache: 'no-store',
  };
}
