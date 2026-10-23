'use client';

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Ownership } from '../nav';

/** What the shell's client components know of the signed-in person. */
export interface ShellMe {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly fullName: string | null;
    readonly preferredLocale: string;
    readonly isEmailVerified: boolean;
    readonly emailBounced: boolean;
  };
  readonly permissions: readonly string[];
  readonly ownership: Ownership;
  readonly signIn: {
    readonly password: boolean;
    readonly google: boolean;
    readonly googleEmail: string | null;
  };
}

const MeContext = createContext<ShellMe | null>(null);

export function MeProvider({ me, children }: { me: ShellMe; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

/** The signed-in person, inside the shell. */
export function useMe(): ShellMe {
  const me = useContext(MeContext);
  if (me === null) throw new Error('useMe() outside the shell');
  return me;
}

/** The account's initial, for its avatar: the name's, else the address's. */
export const initialOf = (me: ShellMe): string =>
  (me.user.fullName?.trim() || me.user.email).charAt(0).toUpperCase();
