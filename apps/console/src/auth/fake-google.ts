'use client';

// The stack's fake Google issuer (ADR 0063), for a development build only: google-sign-in.tsx
// imports this module behind its development check, so a production build never loads it.
import { apiFetch } from '@wayfare/api-client';

declare global {
  interface Window {
    /** The page's credential callback, for the tests (edge flow 2). */
    __wayfareGoogleCallback?: (response: { credential: string }) => void;
    /** The nonce a fake token must carry. */
    __wayfareGoogleNonce?: string;
  }
}

/** Whether the stack runs the fake issuer: `/dev/google-token` answers only then. */
export function fakeIssuer(): Promise<boolean> {
  return apiFetch('/dev/google-token', {
    method: 'POST',
    body: JSON.stringify({ email: 'probe@wayfare.test', emailVerified: true, nonce: 'probe' }),
    anonymous: true,
  }).then(
    () => true,
    () => false,
  );
}

/** A fake token for `email`, minted by the stack for this page's nonce. */
export async function mintFake(email: string, nonce: string): Promise<string> {
  const { data } = await apiFetch<{ data: { idToken: string } }>('/dev/google-token', {
    method: 'POST',
    body: JSON.stringify({ email, emailVerified: true, nonce }),
    anonymous: true,
  });
  return data.idToken;
}

/** Hands the tests the page's nonce and callback; returns how to take them back. */
export function exposeCallback(
  nonce: string,
  callback: (response: { credential: string }) => Promise<void>,
): () => void {
  window.__wayfareGoogleNonce = nonce;
  window.__wayfareGoogleCallback = (response) => void callback(response);
  return () => {
    delete window.__wayfareGoogleNonce;
    delete window.__wayfareGoogleCallback;
  };
}
