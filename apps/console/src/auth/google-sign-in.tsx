'use client';

import { authGoogleNonce } from '@wayfare/api-client';
import { GoogleButton } from '@wayfare/ui/google-button';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID } from '../env';
import { useConsole } from '../i18n/provider';

/** The slice of Google Identity Services the console uses. */
interface GoogleIdentity {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        nonce: string;
        callback: (response: { credential: string }) => void;
        ux_mode: 'popup';
        context: 'signin';
        locale?: string;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          theme: 'outline' | 'filled_black';
          text: 'continue_with';
          size: 'large';
          shape: 'rectangular';
          width: number;
          locale: string;
        },
      ): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

function loadGis(): Promise<GoogleIdentity> {
  if (window.google !== undefined) return Promise.resolve(window.google);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT;
    script.async = true;
    script.onload = () =>
      window.google === undefined ? reject(new Error('GIS')) : resolve(window.google);
    script.onerror = () => reject(new Error('GIS'));
    document.head.append(script);
  });
}

/**
 * *Continue with Google* on the web (K7): Google's own Identity Services button — `outline` in
 * light, `filled_black` in dark, Google's rules — carrying a nonce the gateway bound to this
 * browser's `wf_gn` cookie. Each attempt spends the nonce, so the button is drawn again with a fresh
 * one. With no Web client configured it is not offered, except in a development build against the
 * fake issuer, where round 33's own Google button stands in and the tests reach the callback.
 */
export function GoogleSignIn({
  onCredential,
  disabled,
}: {
  onCredential: (idToken: string) => Promise<void>;
  disabled: boolean;
}) {
  const { t, locale } = useConsole();
  const [mode, setMode] = useState<'pending' | 'google' | 'fake' | 'off'>('pending');
  const [nonce, setNonce] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const slot = useRef<HTMLDivElement>(null);

  const credential = useCallback(
    async ({ credential: idToken }: { credential: string }) => {
      try {
        await onCredential(idToken);
      } finally {
        setAttempt((value) => value + 1);
      }
    },
    [onCredential],
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      // A development build against the stack's fake issuer uses it even with a Web client set: a
      // real Google token would not verify there. The fake's module exists in a development build
      // only — NODE_ENV is folded at build time, so a production build drops the import.
      const fake = process.env.NODE_ENV !== 'production' ? await import('./fake-google') : null;
      const next =
        fake !== null && (await fake.fakeIssuer())
          ? 'fake'
          : GOOGLE_CLIENT_ID !== ''
            ? 'google'
            : 'off';
      if (live) setMode(next);
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (mode === 'pending' || mode === 'off') return;
    let live = true;
    authGoogleNonce({ anonymous: true }).then(
      ({ data }) => live && setNonce(data.nonce),
      () => live && setMode('off'),
    );
    return () => {
      live = false;
    };
  }, [mode, attempt]);

  useEffect(() => {
    if (mode !== 'google' || nonce === null || slot.current === null) return;
    const parent = slot.current;
    loadGis().then(
      (google) => {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce,
          callback: (response) => void credential(response),
          ux_mode: 'popup',
          context: 'signin',
          locale,
        });
        parent.replaceChildren();
        google.accounts.id.renderButton(parent, {
          theme: document.documentElement.classList.contains('dark') ? 'filled_black' : 'outline',
          text: 'continue_with',
          size: 'large',
          shape: 'rectangular',
          width: parent.clientWidth,
          locale,
        });
      },
      () => setMode('off'),
    );
  }, [mode, nonce, credential, locale]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || mode !== 'fake' || nonce === null) return;
    let undo: (() => void) | undefined;
    void import('./fake-google').then(({ exposeCallback }) => {
      undo = exposeCallback(nonce, credential);
    });
    return () => undo?.();
  }, [mode, nonce, credential]);

  if (mode === 'off') return null;
  if (mode === 'pending') return <div aria-hidden className="h-10" />;
  if (mode === 'fake') {
    return (
      <GoogleButton
        disabled={disabled || nonce === null}
        onClick={() => {
          // Development only: the fake issuer's stand-in for Google's chooser.
          const email = window.prompt('Fake Google account (development)');
          if (email === null || email.trim() === '' || nonce === null) return;
          if (process.env.NODE_ENV === 'production') return;
          void import('./fake-google')
            .then(({ mintFake }) => mintFake(email.trim(), nonce))
            .then((idToken) => credential({ credential: idToken }));
        }}
      >
        {t('signIn.google')}
      </GoogleButton>
    );
  }
  // Google's iframe is a light document: under the dark page's `color-scheme` the browser paints it
  // an opaque white box, so its slot keeps a light scheme and the iframe stays transparent.
  return (
    <div
      ref={slot}
      className="flex h-10 w-full justify-center scheme-light"
      aria-busy={nonce === null}
    />
  );
}
