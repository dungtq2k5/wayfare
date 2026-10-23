'use client';

import { useEffect } from 'react';
import { session } from '../../../client/browser-api';
import { readPageCookie, SIGNED_IN_MARKER } from '../../../client/cookies';
import { LinkWorking } from '../../../auth/link';
import { safeNext, signInHref } from '../../../session/next';

/**
 * The session's return (K3, C5): a server page whose call answered `401` sends the visitor here. One
 * refresh, by K4's rule; on success, back to the same-site page; on failure, Sign in with C5's line
 * — when this browser had a session — and the way back.
 */
export default function SessionPage() {
  useEffect(() => {
    const next = safeNext(new URLSearchParams(window.location.search).get('next'));
    void session.refresh().then((fresh) => {
      window.location.replace(
        fresh ? (next ?? '/') : signInHref(next, readPageCookie(SIGNED_IN_MARKER) !== null),
      );
    });
  }, []);
  return <LinkWorking />;
}
